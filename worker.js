// ====================================================================
// ComPhone Lab Worker - Repair sync + WhatsApp automation
// ====================================================================
// Endpoints:
//   GET    /                        -> health check
//   GET    /api/repairs             -> list all known repairs
//   POST   /api/sync                -> scraper pushes report, worker diffs + auto-sends WA
//   POST   /api/wa/send             -> send a single WA (Meta API proxy, solves CORS)
//   GET    /api/wa/log              -> list WA send log
//   POST   /api/wa/log              -> manually add log entry (mark as sent)
//   DELETE /api/wa/log?form=N       -> remove log entry / ?all=1 clear all
//   GET    /api/config              -> get public config (template, hours, etc.)
//   PUT    /api/config              -> update config
//   POST   /api/seed                -> one-time seed from initial Excel (no auto-send)
//
// Auth headers:
//   X-Sync-Key   -> required for /api/sync, /api/seed (scraper side)
//   X-Admin-Key  -> required for everything else (admin PWA side)
//
// Required bindings (wrangler.toml):
//   KV namespace: LAB_KV
//   Secrets: SYNC_KEY, ADMIN_KEY
//   Optional vars: META_TOKEN, META_PHONE_NUMBER_ID (can also be stored in /api/config)
// ====================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key, X-Admin-Key',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', ...CORS };

const GRAPH_API_VERSION = 'v21.0';

const DEFAULT_CONFIG = {
  businessName: 'ComPhone',
  businessHours: "א'–ה' 09:00–19:00 · ו' 09:00–13:00",
  businessAddress: '',
  template: `היי {name} 👋

המכשיר שלך *{device}* מוכן לאיסוף במעבדת {business} 🔧✨

📋 *פירוט התיקון*
• התקלה: {issue}
• הפתרון: {fixed}
• מס' טופס: {form}

💰 *לתשלום:* {price} ₪

🕐 שעות פעילות: {hours}

נשמח לראותך!
צוות {business}`,
  // Auto-send settings:
  autoSend: false,           // false = detect changes but don't auto-send (safe default)
  autoSendTriggers: ['תוקן'], // statuses that trigger a WA on transition
  sendMode: 'meta',          // 'meta' | 'disabled'
  useTemplate: false,         // send Meta pre-approved template vs free text
  templateName: '',
  languageCode: 'he',
  // Secrets (can be stored here OR in Worker env vars):
  metaToken: '',
  phoneNumberId: '',
};

// ====================================================================
// Utilities
// ====================================================================
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const err = (msg, status = 400, extra = {}) => json({ error: msg, ...extra }, status);

function requireSync(request, env) {
  const key = request.headers.get('X-Sync-Key');
  if (!env.SYNC_KEY) return 'Worker missing SYNC_KEY secret';
  if (!key || key !== env.SYNC_KEY) return 'Invalid X-Sync-Key';
  return null;
}
function requireAdmin(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY) return 'Worker missing ADMIN_KEY secret';
  if (!key || key !== env.ADMIN_KEY) return 'Invalid X-Admin-Key';
  return null;
}

async function kvGet(env, key, fallback) {
  const v = await env.LAB_KV.get(key);
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}
async function kvPut(env, key, value) {
  return env.LAB_KV.put(key, JSON.stringify(value));
}

async function loadConfig(env) {
  const stored = await kvGet(env, 'config', {});
  const merged = { ...DEFAULT_CONFIG, ...stored };
  // Env vars override stored secrets if present
  if (env.META_TOKEN) merged.metaToken = env.META_TOKEN;
  if (env.META_PHONE_NUMBER_ID) merged.phoneNumberId = env.META_PHONE_NUMBER_ID;
  return merged;
}

function redactConfig(cfg) {
  const out = { ...cfg };
  if (out.metaToken) out.metaToken = '***' + out.metaToken.slice(-6);
  return out;
}

function formatPhoneIntl(p) {
  if (!p) return null;
  let s = String(p).replace(/\D/g, '');
  if (s.startsWith('972')) return s;
  if (s.startsWith('0')) s = s.slice(1);
  if (s.length < 8) return null;
  return '972' + s;
}

function fillTemplate(tpl, r, cfg) {
  const price = (r.charge && r.charge > 0) ? Number(r.charge).toLocaleString('he-IL') : '—';
  return String(tpl)
    .replace(/\{name\}/g, r.name || 'לקוח יקר')
    .replace(/\{device\}/g, r.device || '—')
    .replace(/\{issue\}/g, String(r.issue || '—').replace(/\n+/g, ' '))
    .replace(/\{fixed\}/g, String(r.fixed || 'בוצע טיפול במעבדה').replace(/\n+/g, ' '))
    .replace(/\{form\}/g, r.form || '—')
    .replace(/\{price\}/g, price)
    .replace(/\{phone\}/g, r.phone || '—')
    .replace(/\{received\}/g, r.received || '—')
    .replace(/\{status\}/g, r.status || '—')
    .replace(/\{business\}/g, cfg.businessName || '')
    .replace(/\{hours\}/g, cfg.businessHours || '')
    .replace(/\{address\}/g, cfg.businessAddress || '');
}

// Normalize incoming repair record from any source (scraper/seed)
function normalizeRepair(r) {
  if (!r) return null;
  // Accept both Hebrew-keyed (from scraper) and English-keyed (from PWA/seed)
  const pick = (...keys) => {
    for (const k of keys) {
      if (r[k] != null && r[k] !== '') return r[k];
    }
    return null;
  };
  const numClean = (v) => {
    if (v == null || v === '') return null;
    const s = String(v).replace(/[,\s₪]/g, '');
    const n = Number(s);
    return isNaN(n) ? null : n;
  };

  const phoneRaw = pick('phone', 'טלפון');
  let phone = null;
  if (phoneRaw) {
    let p = String(phoneRaw).replace(/\D/g, '');
    if (p.length === 9 && !p.startsWith('0')) p = '0' + p;
    phone = p;
  }

  const form = pick('form', 'טופס');
  const formNum = form != null ? Number(String(form).replace(/\D/g, '')) : null;
  if (!formNum) return null; // can't track without form number

  return {
    form: formNum,
    name:       pick('name', 'שם הלקוח'),
    phone,
    device:     pick('device', 'דגם מכשיר'),
    issue:      pick('issue', 'תקלה'),
    fixed:      pick('fixed', 'מה תוקן'),
    internal:   pick('internal', 'מלל פנימי'),
    charge:     numClean(pick('charge', 'חיוב')),
    parts:      numClean(pick('parts', 'סכום חלקים')),
    cost:       numClean(pick('cost', 'עלות')),
    imei:       pick('imei', 'IMEI'),
    status:     pick('status', 'סטטוס'),
    received:   pick('received', 'תאריך קבלה'),
    delivered:  pick('delivered', 'תאריך מסירה'),
    waitDays:   numClean(pick('waitDays', 'ימי המתנה')),
    labHours:   numClean(pick('labHours', 'שעות שהייה במעבדה')),
    receivedBy: pick('receivedBy', 'התקבל ע"י'),
    custType:   pick('custType', 'סוג לקוח'),
    insurance:  numClean(pick('insurance', 'ביטוח')),
    branch:     numClean(pick('branch', 'קוד סניף')),
  };
}

// ====================================================================
// Meta WhatsApp API
// ====================================================================
async function sendWhatsApp(cfg, to, message, repair) {
  if (!cfg.metaToken || !cfg.phoneNumberId) {
    return { ok: false, error: 'Missing Meta token or phoneNumberId' };
  }
  const intl = formatPhoneIntl(to);
  if (!intl) return { ok: false, error: 'Invalid phone number' };

  let body;
  if (cfg.useTemplate && cfg.templateName) {
    body = {
      messaging_product: 'whatsapp',
      to: intl,
      type: 'template',
      template: {
        name: cfg.templateName,
        language: { code: cfg.languageCode || 'he' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: repair?.name || 'לקוח' },
            { type: 'text', text: repair?.device || '—' },
            { type: 'text', text: (repair?.charge && repair.charge > 0) ? String(repair.charge) : '0' },
            { type: 'text', text: String(repair?.form || '—') },
          ],
        }],
      },
    };
  } else {
    body = {
      messaging_product: 'whatsapp',
      to: intl,
      type: 'text',
      text: { body: message, preview_url: false },
    };
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${cfg.phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.metaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      return { ok: true, messageId: data.messages?.[0]?.id, response: data };
    } else {
      return {
        ok: false,
        error: data.error?.message || `HTTP ${res.status}`,
        code: data.error?.code,
        details: data,
      };
    }
  } catch (e) {
    return { ok: false, error: 'Network error: ' + e.message };
  }
}

// ====================================================================
// Route handlers
// ====================================================================

async function apiGetRepairs(request, env) {
  const gate = requireAdmin(request, env);
  if (gate) return err(gate, 401);
  const repairs = await kvGet(env, 'repairs:all', {});
  const seeded = await kvGet(env, 'state:seeded', false);
  const lastSync = await kvGet(env, 'state:lastSync', null);
  return json({
    repairs: Object.values(repairs),
    seeded,
    lastSync,
    count: Object.keys(repairs).length,
  });
}

async function apiSync(request, env, ctx) {
  const gate = requireSync(request, env);
  if (gate) return err(gate, 401);

  let payload;
  try { payload = await request.json(); }
  catch { return err('Invalid JSON'); }

  const incoming = Array.isArray(payload.repairs) ? payload.repairs : [];
  if (!incoming.length) return err('No repairs in payload');

  const current = await kvGet(env, 'repairs:all', {});
  const seeded = await kvGet(env, 'state:seeded', false);
  const cfg = await loadConfig(env);
  const sentLog = await kvGet(env, 'log:sent', []);
  const sentForms = new Set(sentLog.map(x => x.form));

  const added = [];
  const statusChanged = [];
  const unchanged = [];
  const triggers = []; // repairs that should get WA

  for (const raw of incoming) {
    const r = normalizeRepair(raw);
    if (!r) continue;
    const prev = current[r.form];

    if (!prev) {
      // NEW repair
      added.push(r);
      current[r.form] = r;
      // Trigger if new repair already carries trigger status AND we've seeded
      if (seeded && cfg.autoSendTriggers.includes(r.status) && !sentForms.has(r.form)) {
        triggers.push(r);
      }
    } else if (prev.status !== r.status) {
      // Status changed
      statusChanged.push({ form: r.form, name: r.name, from: prev.status, to: r.status });
      current[r.form] = r;
      if (cfg.autoSendTriggers.includes(r.status) && !sentForms.has(r.form)) {
        triggers.push(r);
      }
    } else {
      // Same status - still update data fields (charge may have changed, etc.)
      current[r.form] = { ...prev, ...r };
      unchanged.push(r.form);
    }
  }

  // ---- Auto-send WA for triggered repairs ----
  const autoSent = [];
  const autoFailed = [];

  if (cfg.autoSend && cfg.sendMode === 'meta' && triggers.length > 0) {
    for (const r of triggers) {
      if (!r.phone) { autoFailed.push({ form: r.form, error: 'no phone' }); continue; }
      const message = fillTemplate(cfg.template, r, cfg);
      const res = await sendWhatsApp(cfg, r.phone, message, r);
      if (res.ok) {
        autoSent.push({ form: r.form, name: r.name, phone: r.phone, messageId: res.messageId });
        sentLog.unshift({
          form: r.form,
          name: r.name,
          phone: r.phone,
          device: r.device,
          method: 'auto-api',
          ts: Date.now(),
          messageId: res.messageId,
        });
      } else {
        autoFailed.push({ form: r.form, name: r.name, error: res.error });
      }
    }
  }

  // ---- Persist ----
  await kvPut(env, 'repairs:all', current);
  await kvPut(env, 'log:sent', sentLog.slice(0, 500)); // cap log size
  await kvPut(env, 'state:lastSync', Date.now());
  if (!seeded) await kvPut(env, 'state:seeded', true);

  return json({
    ok: true,
    stats: {
      received: incoming.length,
      added: added.length,
      statusChanged: statusChanged.length,
      unchanged: unchanged.length,
      triggered: triggers.length,
      autoSent: autoSent.length,
      autoFailed: autoFailed.length,
    },
    details: {
      added: added.map(r => ({ form: r.form, name: r.name, status: r.status })),
      statusChanged,
      autoSent,
      autoFailed,
      pendingManual: cfg.autoSend ? [] : triggers.map(r => ({
        form: r.form, name: r.name, phone: r.phone, status: r.status,
      })),
    },
    seededNow: !seeded,
  });
}

async function apiWaSend(request, env) {
  const gate = requireAdmin(request, env);
  if (gate) return err(gate, 401);

  let payload;
  try { payload = await request.json(); }
  catch { return err('Invalid JSON'); }

  const { form, to, message } = payload;
  if (!to) return err('Missing "to" (phone number)');

  const cfg = await loadConfig(env);
  let repair = null;
  if (form) {
    const all = await kvGet(env, 'repairs:all', {});
    repair = all[form] || null;
  }
  const msg = message || (repair ? fillTemplate(cfg.template, repair, cfg) : '');
  if (!msg) return err('No message to send');

  const res = await sendWhatsApp(cfg, to, msg, repair);
  if (res.ok) {
    // log it
    const sentLog = await kvGet(env, 'log:sent', []);
    sentLog.unshift({
      form: form || null,
      name: repair?.name,
      phone: to,
      device: repair?.device,
      method: 'manual-api',
      ts: Date.now(),
      messageId: res.messageId,
    });
    await kvPut(env, 'log:sent', sentLog.slice(0, 500));
  }
  return json(res);
}

async function apiGetLog(request, env) {
  const gate = requireAdmin(request, env);
  if (gate) return err(gate, 401);
  const log = await kvGet(env, 'log:sent', []);
  return json({ log, count: log.length });
}

async function apiAddLog(request, env) {
  const gate = requireAdmin(request, env);
  if (gate) return err(gate, 401);
  let payload;
  try { payload = await request.json(); } catch { return err('Invalid JSON'); }
  const { form, name, phone, device, method = 'manual' } = payload;
  if (!form) return err('form required');
  const log = await kvGet(env, 'log:sent', []);
  log.unshift({ form, name, phone, device, method, ts: Date.now() });
  await kvPut(env, 'log:sent', log.slice(0, 500));
  return json({ ok: true, count: log.length });
}

async function apiClearLog(request, env) {
  const gate = requireAdmin(request, env);
  if (gate) return err(gate, 401);
  const url = new URL(request.url);
  const all = url.searchParams.get('all');
  const form = url.searchParams.get('form');

  if (all) {
    await kvPut(env, 'log:sent', []);
    return json({ ok: true, cleared: 'all' });
  }
  if (form) {
    const log = await kvGet(env, 'log:sent', []);
    const n = log.length;
    const filtered = log.filter(x => String(x.form) !== String(form));
    await kvPut(env, 'log:sent', filtered);
    return json({ ok: true, removed: n - filtered.length });
  }
  return err('Provide ?all=1 or ?form=NUMBER');
}

async function apiGetConfig(request, env) {
  const gate = requireAdmin(request, env);
  if (gate) return err(gate, 401);
  const cfg = await loadConfig(env);
  return json({ config: redactConfig(cfg) });
}

async function apiPutConfig(request, env) {
  const gate = requireAdmin(request, env);
  if (gate) return err(gate, 401);
  let payload;
  try { payload = await request.json(); } catch { return err('Invalid JSON'); }

  const stored = await kvGet(env, 'config', {});
  // Only allow updating known fields
  const allowed = ['businessName','businessHours','businessAddress','template',
                   'autoSend','autoSendTriggers','sendMode','useTemplate',
                   'templateName','languageCode','metaToken','phoneNumberId'];
  for (const k of allowed) {
    if (k in payload) {
      // Empty string tokens are ignored (prevents accidental wipe)
      if ((k === 'metaToken' || k === 'phoneNumberId') && payload[k] === '') continue;
      stored[k] = payload[k];
    }
  }
  await kvPut(env, 'config', stored);
  const merged = { ...DEFAULT_CONFIG, ...stored };
  return json({ ok: true, config: redactConfig(merged) });
}

async function apiSeed(request, env) {
  const gate = requireSync(request, env);
  if (gate) return err(gate, 401);
  let payload;
  try { payload = await request.json(); } catch { return err('Invalid JSON'); }
  const incoming = Array.isArray(payload.repairs) ? payload.repairs : [];
  if (!incoming.length) return err('No repairs in payload');

  const current = payload.replace ? {} : await kvGet(env, 'repairs:all', {});
  let count = 0;
  for (const raw of incoming) {
    const r = normalizeRepair(raw);
    if (!r) continue;
    current[r.form] = r;
    count++;
  }
  await kvPut(env, 'repairs:all', current);
  await kvPut(env, 'state:seeded', true);
  await kvPut(env, 'state:lastSync', Date.now());
  return json({ ok: true, seeded: count, totalStored: Object.keys(current).length });
}

// ====================================================================
// Main router
// ====================================================================
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const m = request.method;

    try {
      if (p === '/' || p === '/health') {
        return json({ ok: true, service: 'comphone-lab-worker', time: new Date().toISOString() });
      }
      if (p === '/api/repairs' && m === 'GET')   return apiGetRepairs(request, env);
      if (p === '/api/sync'    && m === 'POST')  return apiSync(request, env, ctx);
      if (p === '/api/seed'    && m === 'POST')  return apiSeed(request, env);
      if (p === '/api/wa/send' && m === 'POST')  return apiWaSend(request, env);
      if (p === '/api/wa/log'  && m === 'GET')   return apiGetLog(request, env);
      if (p === '/api/wa/log'  && m === 'POST')  return apiAddLog(request, env);
      if (p === '/api/wa/log'  && m === 'DELETE')return apiClearLog(request, env);
      if (p === '/api/config'  && m === 'GET')   return apiGetConfig(request, env);
      if (p === '/api/config'  && m === 'PUT')   return apiPutConfig(request, env);

      return err('Not found: ' + m + ' ' + p, 404);
    } catch (e) {
      console.error(e);
      return err(String(e.message || e), 500, { stack: e.stack });
    }
  },
};
