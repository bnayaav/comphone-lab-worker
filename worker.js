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


// ====================================================================
// Embedded PWA - served at /
// ====================================================================
const PWA_HTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#0b3d3a">
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="ComPhone Lab">
<link rel="apple-touch-icon" href="/icon-192.png">
<title>מעבדה · ComPhone (מחובר)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #f6f3ec;
  --bg-grain: #efeadf;
  --surface: #ffffff;
  --surface-2: #faf8f3;
  --ink: #0a0a0a;
  --ink-2: #3f3f3f;
  --ink-3: #757575;
  --line: #e4dfd4;
  --line-2: #d4cfc3;
  --brand: #0b3d3a;
  --brand-2: #0f5650;
  --brand-soft: #d6e7e3;
  --accent: #ea580c;
  --accent-soft: #fff0e4;
  --success: #047857;
  --success-soft: #d1fae5;
  --warn: #b45309;
  --warn-soft: #fef3c7;
  --danger: #b91c1c;
  --danger-soft: #fee2e2;
  --muted: #6b7280;
  --muted-soft: #e5e7eb;
  --purple: #6d28d9;
  --purple-soft: #ede9fe;
  --radius: 14px;
  --radius-sm: 8px;
  --shadow-sm: 0 1px 2px rgba(11,61,58,.04), 0 1px 3px rgba(11,61,58,.06);
  --shadow-md: 0 4px 6px -1px rgba(11,61,58,.05), 0 2px 4px -2px rgba(11,61,58,.05);
  --shadow-lg: 0 10px 15px -3px rgba(11,61,58,.08), 0 4px 6px -4px rgba(11,61,58,.05);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  font-family: 'Rubik', -apple-system, system-ui, sans-serif;
  background: var(--bg);
  color: var(--ink);
  font-feature-settings: "kern", "liga";
  -webkit-font-smoothing: antialiased;
  font-size: 15px;
  line-height: 1.5;
  min-height: 100vh;
}

body {
  background-image:
    radial-gradient(circle at 20% 0%, #e8f0ed 0%, transparent 40%),
    radial-gradient(circle at 90% 10%, #fbe9d7 0%, transparent 35%),
    linear-gradient(var(--bg), var(--bg));
  background-attachment: fixed;
}

code, .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: .85em; }

/* ===== Layout ===== */
.app {
  max-width: 1280px;
  margin: 0 auto;
  padding: 16px 16px 120px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  background: rgba(255,255,255,.7);
  backdrop-filter: blur(12px);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  margin-bottom: 18px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: linear-gradient(135deg, var(--brand), var(--brand-2));
  display: grid;
  place-items: center;
  color: #e9f3f1;
  font-weight: 800;
  font-size: 15px;
  letter-spacing: -.02em;
  box-shadow: inset 0 -2px 0 rgba(0,0,0,.15), 0 4px 10px rgba(11,61,58,.25);
}

.brand-text h1 {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -.01em;
}
.brand-text .sub {
  font-size: 12px;
  color: var(--ink-3);
  font-weight: 500;
}

.topbar-actions {
  display: flex;
  gap: 6px;
}

.icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--ink-2);
  transition: all .15s;
  font-size: 16px;
}
.icon-btn:hover { background: var(--brand-soft); color: var(--brand); border-color: var(--brand-soft); }
.icon-btn.has-badge { position: relative; }
.icon-btn .badge {
  position: absolute;
  top: -3px;
  left: -3px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: var(--accent);
  color: white;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  display: grid;
  place-items: center;
  border: 2px solid var(--bg);
}

/* ===== Stats ===== */
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 18px;
}
.stat {
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  position: relative;
  overflow: hidden;
  transition: all .15s;
}
.stat:hover { border-color: var(--line-2); box-shadow: var(--shadow-md); }
.stat .label {
  font-size: 11.5px;
  color: var(--ink-3);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .05em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.stat .value {
  font-size: 26px;
  font-weight: 700;
  margin-top: 4px;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
}
.stat .sub {
  font-size: 11.5px;
  color: var(--ink-3);
  margin-top: 2px;
  font-weight: 500;
}
.stat.accent::before {
  content: '';
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 4px;
  background: var(--accent);
}
.stat.brand::before {
  content: '';
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 4px;
  background: var(--brand);
}
.stat.success::before {
  content: '';
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 4px;
  background: var(--success);
}

/* ===== Banner ===== */
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #0b3d3a, #0f5650);
  color: #e9f3f1;
  border-radius: var(--radius);
  margin-bottom: 14px;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}
.banner::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 90% 50%, rgba(234,88,12,.18), transparent 50%);
  pointer-events: none;
}
.banner-text {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  position: relative;
  z-index: 1;
}
.banner-text b { font-weight: 700; }
.banner .mode-pill {
  background: rgba(255,255,255,.15);
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.banner .mode-pill::before {
  content: '';
  width: 6px; height: 6px;
  background: #fbbf24;
  border-radius: 50%;
  display: inline-block;
}
.banner .mode-pill.live::before { background: #34d399; box-shadow: 0 0 0 3px rgba(52,211,153,.25); }
.banner-actions {
  display: flex;
  gap: 6px;
  position: relative;
  z-index: 1;
}
.banner-btn {
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.18);
  color: #e9f3f1;
  padding: 7px 11px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s;
  font-family: inherit;
}
.banner-btn:hover { background: rgba(255,255,255,.22); }

/* ===== Filters ===== */
.filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  margin-bottom: 14px;
}
.filter-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.search {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 12px;
  transition: all .15s;
}
.search:focus-within {
  border-color: var(--brand);
  background: white;
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.search svg { color: var(--ink-3); flex-shrink: 0; }
.search input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 10px 8px;
  font-family: inherit;
  font-size: 14px;
  color: var(--ink);
  outline: none;
}
.sort {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 12px;
  font-family: inherit;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  outline: none;
}

.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  background: var(--surface-2);
  border: 1px solid var(--line);
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all .15s;
  color: var(--ink-2);
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.chip:hover { border-color: var(--line-2); }
.chip.active {
  background: var(--ink);
  color: white;
  border-color: var(--ink);
}
.chip .count {
  background: rgba(0,0,0,.08);
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.chip.active .count { background: rgba(255,255,255,.2); color: white; }

/* ===== Results count ===== */
.results-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  margin-bottom: 12px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.results-meta b { color: var(--ink); font-weight: 600; }

/* ===== Repair Cards ===== */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: all .15s;
  position: relative;
}
.card:hover {
  border-color: var(--line-2);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
.card::before {
  content: '';
  position: absolute;
  right: 0; top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 3px;
  background: var(--line);
}
.card[data-s="תוקן"]::before { background: var(--warn); }
.card[data-s="נמסר ללקוח"]::before { background: var(--success); }
.card[data-s="מושבת"]::before { background: var(--danger); }
.card[data-s="ממתין"]::before { background: var(--muted); }
.card[data-s="ממתין לתשובה מלקוח"]::before { background: var(--purple); }

.card.needs-wa::after {
  content: 'מומלץ לשלוח וואטסאפ';
  position: absolute;
  top: -1px;
  right: -1px;
  background: var(--accent);
  color: white;
  font-size: 10.5px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: var(--radius) 0 var(--radius-sm) 0;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.card-name {
  font-weight: 700;
  font-size: 15.5px;
  letter-spacing: -.01em;
  line-height: 1.25;
}
.card-meta {
  font-size: 12px;
  color: var(--ink-3);
  margin-top: 2px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.card-meta .dot { opacity: .5; }

.status-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
  letter-spacing: -.01em;
}
.s-תוקן { background: var(--warn-soft); color: var(--warn); }
.s-נמסר_ללקוח { background: var(--success-soft); color: var(--success); }
.s-מושבת { background: var(--danger-soft); color: var(--danger); }
.s-ממתין { background: var(--muted-soft); color: var(--muted); }
.s-ממתין_לתשובה_מלקוח { background: var(--purple-soft); color: var(--purple); }

.card-device {
  background: var(--brand-soft);
  color: var(--brand);
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
}

.field {
  font-size: 13px;
  line-height: 1.45;
}
.field .k {
  font-size: 11px;
  color: var(--ink-3);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .04em;
  margin-bottom: 2px;
}
.field .v {
  color: var(--ink-2);
  white-space: pre-wrap;
  word-break: break-word;
}
.field.clip .v {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  margin-top: 2px;
}
.price {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
}
.price.zero { color: var(--ink-3); }
.price .cur { color: var(--ink-3); font-size: 12px; font-weight: 500; margin-right: 2px; }

.wa-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #25D366;
  color: white;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition: all .15s;
}
.wa-btn:hover { background: #1ebe5a; transform: translateY(-1px); box-shadow: 0 4px 10px rgba(37,211,102,.3); }
.wa-btn.sent { background: var(--muted); }
.wa-btn.sent:hover { background: var(--muted); transform: none; box-shadow: none; }

/* ===== Modal ===== */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(10,10,10,.5);
  backdrop-filter: blur(4px);
  display: grid;
  place-items: center;
  padding: 16px;
  z-index: 50;
  animation: fade .15s ease;
}
@keyframes fade { from { opacity: 0; } }
.modal {
  background: var(--surface);
  border-radius: 18px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.25);
  animation: pop .2s cubic-bezier(.2,.8,.3,1.1);
}
@keyframes pop { from { transform: scale(.95); opacity: 0; } }
.modal.wide { max-width: 720px; }

.modal-head {
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 5;
}
.modal-head h2 { font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
.modal-head .sub { font-size: 12.5px; color: var(--ink-3); margin-top: 2px; }
.close-btn {
  width: 32px; height: 32px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: pointer;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  font-size: 18px;
  font-family: inherit;
  line-height: 1;
}
.close-btn:hover { background: var(--danger-soft); color: var(--danger); border-color: var(--danger-soft); }
.modal-body { padding: 16px 20px 20px; }

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.detail-grid .field {
  background: var(--surface-2);
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
}
.detail-grid .field.wide { grid-column: 1 / -1; }

.preview-box {
  background: #e8f5e9;
  background-image:
    linear-gradient(rgba(255,255,255,.5), rgba(255,255,255,.5)),
    repeating-linear-gradient(45deg, transparent 0 20px, rgba(0,0,0,.02) 20px 21px);
  border: 1px solid #c8e6c9;
  border-radius: 12px;
  padding: 14px 16px;
  position: relative;
}
.preview-box::before {
  content: '';
  position: absolute;
  top: 12px; right: -6px;
  border: 8px solid transparent;
  border-left-color: transparent;
  border-right-color: #c8e6c9;
  transform: scaleX(-1);
}
.preview-box textarea {
  width: 100%;
  background: transparent;
  border: none;
  resize: vertical;
  min-height: 180px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink);
  outline: none;
  white-space: pre-wrap;
}
.preview-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0 6px;
  font-size: 12px;
  color: var(--ink-3);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.preview-label .chars { font-variant-numeric: tabular-nums; }

.modal-actions {
  display: flex;
  gap: 8px;
  padding-top: 16px;
  flex-wrap: wrap;
}
.btn {
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  transition: all .15s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  justify-content: center;
}
.btn-primary {
  background: #25D366;
  color: white;
  flex: 1;
  min-width: 140px;
}
.btn-primary:hover { background: #1ebe5a; box-shadow: 0 4px 12px rgba(37,211,102,.3); }
.btn-primary:disabled { background: var(--muted); cursor: not-allowed; }

.btn-secondary {
  background: var(--surface-2);
  border-color: var(--line);
  color: var(--ink-2);
}
.btn-secondary:hover { background: var(--line); }

.btn-ghost {
  background: transparent;
  color: var(--ink-2);
}
.btn-ghost:hover { background: var(--surface-2); }

.tabs {
  display: flex;
  gap: 2px;
  background: var(--surface-2);
  padding: 3px;
  border-radius: 10px;
  border: 1px solid var(--line);
  margin-bottom: 14px;
}
.tab {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  color: var(--ink-3);
  text-align: center;
  background: transparent;
  border: none;
  font-family: inherit;
  transition: all .15s;
}
.tab.active { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-sm); }

.form-field { margin-bottom: 12px; }
.form-field label {
  display: block;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink-2);
  margin-bottom: 5px;
}
.form-field input, .form-field textarea, .form-field select {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--ink);
  background: white;
  outline: none;
  transition: all .15s;
}
.form-field input:focus, .form-field textarea:focus, .form-field select:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}
.form-field textarea { resize: vertical; min-height: 80px; font-family: inherit; }
.form-field .hint { font-size: 11.5px; color: var(--ink-3); margin-top: 4px; }

.var-chips {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.var-chip {
  background: var(--brand-soft);
  color: var(--brand);
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  font-family: 'JetBrains Mono', monospace;
  transition: all .12s;
}
.var-chip:hover { background: var(--brand); color: white; }

.log-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.log-item:last-child { border-bottom: none; }
.log-item .when { color: var(--ink-3); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.log-method {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--muted-soft);
  color: var(--ink-2);
  font-weight: 600;
}
.log-method.api { background: var(--brand-soft); color: var(--brand); }

.empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--ink-3);
}
.empty .big { font-size: 36px; margin-bottom: 8px; }

.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--ink);
  color: white;
  padding: 12px 20px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 500;
  z-index: 100;
  animation: toast-in .2s;
  box-shadow: 0 10px 25px rgba(0,0,0,.25);
}
@keyframes toast-in { from { transform: translate(-50%, 20px); opacity: 0; } }

/* ===== Responsive ===== */
@media (max-width: 720px) {
  .app { padding: 10px 10px 80px; }
  .stats { grid-template-columns: repeat(2, 1fr); }
  .stat .value { font-size: 22px; }
  .banner { flex-direction: column; align-items: flex-start; }
  .grid { grid-template-columns: 1fr; }
  .detail-grid { grid-template-columns: 1fr; }
  .topbar { padding: 10px 12px; }
  .brand-text h1 { font-size: 15px; }
  .filter-row { flex-wrap: wrap; }
  .sort { flex: 1; }
}

@media (max-width: 420px) {
  .stats { grid-template-columns: 1fr 1fr; }
}

.sync-dot {
  width: 10px; height: 10px; border-radius: 50%;
  align-self: center; margin-left: 4px;
  transition: all .2s;
}
.sync-dot.online {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16,185,129,.2);
  animation: pulse 2s ease-in-out infinite;
}
.sync-dot.offline {
  background: #9ca3af;
}
.sync-dot.syncing {
  background: #f59e0b;
  animation: spin-pulse 1s infinite;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(16,185,129,.2); }
  50% { box-shadow: 0 0 0 6px rgba(16,185,129,.0); }
}
@keyframes spin-pulse {
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: .5; transform: scale(1.2); }
  100% { opacity: 1; transform: scale(1); }
}

/* ========== Install PWA Popup ========== */
.install-overlay {
  position: fixed; inset: 0;
  background: rgba(10, 10, 10, 0.85);
  backdrop-filter: blur(12px);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
  padding: 20px;
  animation: overlayFade .3s ease;
}
@keyframes overlayFade { from { opacity: 0; } }

.install-card {
  background: linear-gradient(135deg, #ffffff 0%, #f6f3ec 100%);
  border-radius: 24px;
  padding: 32px 24px 24px;
  width: 100%;
  max-width: 380px;
  position: relative;
  box-shadow: 0 25px 60px rgba(0,0,0,.3);
  animation: cardPop .4s cubic-bezier(.2,.8,.3,1.1);
  overflow: hidden;
}
@keyframes cardPop { from { transform: scale(.9) translateY(20px); opacity: 0; } }

.install-card::before {
  content: "";
  position: absolute;
  top: -60px; right: -60px;
  width: 200px; height: 200px;
  background: radial-gradient(circle, rgba(234,88,12,.12), transparent 70%);
  border-radius: 50%;
}
.install-card::after {
  content: "";
  position: absolute;
  bottom: -80px; left: -60px;
  width: 200px; height: 200px;
  background: radial-gradient(circle, rgba(11,61,58,.1), transparent 70%);
  border-radius: 50%;
}

.install-close {
  position: absolute;
  top: 14px; left: 14px;
  width: 32px; height: 32px;
  background: rgba(0,0,0,.05);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  color: #666;
  display: grid;
  place-items: center;
  z-index: 3;
  transition: all .15s;
}
.install-close:hover { background: rgba(0,0,0,.1); color: #000; }

.install-logo {
  width: 104px; height: 104px;
  margin: 0 auto 18px;
  background: linear-gradient(135deg, #0b3d3a, #0f5650);
  border-radius: 26px;
  display: grid;
  place-items: center;
  color: #e9f3f1;
  font-weight: 800;
  font-size: 38px;
  letter-spacing: -.02em;
  box-shadow:
    inset 0 -3px 0 rgba(0,0,0,.18),
    0 12px 30px rgba(11,61,58,.35),
    0 4px 10px rgba(11,61,58,.25);
  position: relative;
  z-index: 2;
  animation: logoFloat 3s ease-in-out infinite;
}
@keyframes logoFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
.install-logo::after {
  content: "🔧";
  position: absolute;
  bottom: -6px; right: -6px;
  width: 36px; height: 36px;
  background: #ea580c;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 18px;
  border: 3px solid white;
  animation: wrench 4s ease-in-out infinite;
}
@keyframes wrench {
  0%, 90%, 100% { transform: rotate(0); }
  95% { transform: rotate(25deg); }
}

.install-title {
  text-align: center;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -.02em;
  color: #0a0a0a;
  margin-bottom: 4px;
  position: relative;
  z-index: 2;
}
.install-subtitle {
  text-align: center;
  font-size: 14px;
  color: #666;
  margin-bottom: 22px;
  line-height: 1.5;
  position: relative;
  z-index: 2;
}
.install-features {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  position: relative;
  z-index: 2;
}
.install-features li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  font-size: 13.5px;
  color: #333;
  border-bottom: 1px dashed #e4dfd4;
}
.install-features li:last-child { border-bottom: none; }
.install-features .ico {
  width: 28px; height: 28px;
  background: rgba(11,61,58,.08);
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 14px;
  flex-shrink: 0;
}

.install-btn {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #0b3d3a, #0f5650);
  color: white;
  border: none;
  border-radius: 14px;
  font-family: inherit;
  font-size: 15.5px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
  z-index: 2;
  box-shadow: 0 8px 20px rgba(11,61,58,.3);
  transition: all .2s;
}
.install-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 25px rgba(11,61,58,.4);
}
.install-btn:active { transform: translateY(0); }

.install-skip {
  width: 100%;
  padding: 12px;
  background: transparent;
  color: #888;
  border: none;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 6px;
  position: relative;
  z-index: 2;
}
.install-skip:hover { color: #333; background: rgba(0,0,0,.04); }

.install-ios-steps {
  background: #f6f3ec;
  border: 1px solid #e4dfd4;
  border-radius: 12px;
  padding: 14px;
  margin-top: 12px;
  font-size: 13px;
  color: #3f3f3f;
  line-height: 1.7;
  position: relative;
  z-index: 2;
  display: none;
}
.install-ios-steps.show { display: block; }
.install-ios-steps b { color: #0b3d3a; }
.install-ios-steps .step {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  align-items: center;
}
.install-ios-steps .num {
  width: 22px; height: 22px;
  background: #0b3d3a;
  color: white;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.hidden { display: none !important; }
</style>
</head>
<body>

<div class="app">

  <!-- Top Bar -->
  <div class="topbar">
    <div class="brand">
      <div class="brand-mark">CP</div>
      <div class="brand-text">
        <h1>מעבדת תיקונים · ComPhone</h1>
        <div class="sub">סניף 2 · שליחת וואטסאפ ללקוחות</div>
      </div>
    </div>
    <div class="topbar-actions">
      <span class="sync-dot offline" id="syncIndicator" title="לא מחובר"></span>
      <button class="icon-btn" id="btnRefresh" title="רענון">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
      </button>
      <button class="icon-btn" id="btnWorker" title="חיבור ל-Worker">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12a7 7 0 0 1 14 0"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/></svg>
      </button>
      <button class="icon-btn has-badge" id="btnLog" title="יומן שליחות">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/><path d="M12 7v5l4 2"/></svg>
        <span class="badge hidden" id="logBadge">0</span>
      </button>
      <button class="icon-btn" id="btnTemplate" title="תבנית הודעה">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16v16H4z"/><path d="M4 9h16"/><path d="M9 4v16"/></svg>
      </button>
      <button class="icon-btn" id="btnSettings" title="הגדרות">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
  </div>

  <!-- Stats -->
  <div class="stats">
    <div class="stat brand">
      <div class="label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/></svg>
        סה"כ תיקונים
      </div>
      <div class="value" id="sTotal">0</div>
      <div class="sub" id="sTotalSub">מתוך הנתונים שעלו</div>
    </div>
    <div class="stat accent">
      <div class="label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        ממתינים לשליחה
      </div>
      <div class="value" id="sNeedsWA">0</div>
      <div class="sub">תוקן וממתין לאיסוף</div>
    </div>
    <div class="stat success">
      <div class="label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>
        נמסרו ללקוח
      </div>
      <div class="value" id="sDelivered">0</div>
      <div class="sub" id="sDeliveredSub">מכלל הרשומות</div>
    </div>
    <div class="stat">
      <div class="label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        הכנסות
      </div>
      <div class="value" id="sRevenue">₪0</div>
      <div class="sub">חיוב כולל</div>
    </div>
  </div>

  <!-- Mode Banner -->
  <div class="banner">
    <div class="banner-text">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.19 1.6 6.02L0 24l6.2-1.63A11.93 11.93 0 0 0 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0zm6.14 17.15c-.26.73-1.52 1.39-2.11 1.47-.54.07-1.21.1-1.95-.12-.45-.14-1.03-.33-1.76-.65-3.1-1.34-5.12-4.47-5.27-4.67-.15-.2-1.25-1.66-1.25-3.17s.79-2.25 1.07-2.56c.28-.31.61-.38.82-.38.2 0 .41 0 .58.01.19.01.45-.07.7.53.26.62.88 2.13.96 2.28.08.15.13.33.03.53-.1.2-.15.33-.3.51-.15.18-.32.4-.45.54-.15.15-.31.32-.13.62.17.3.78 1.28 1.67 2.07 1.14 1.02 2.11 1.33 2.41 1.49.3.15.47.13.65-.08.17-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.73.82 2.02.97.3.15.49.22.56.34.08.13.08.73-.18 1.46z"/></svg>
      <div>
        <div><b>מצב שליחה:</b> <span id="modeText">wa.me (פתיחה ידנית)</span></div>
      </div>
      <span class="mode-pill" id="modePill">ידני</span>
    </div>
    <div class="banner-actions">
      <button class="banner-btn" id="btnTemplate2">ערוך תבנית</button>
      <button class="banner-btn" id="btnSettings2">הגדר Meta API</button>
    </div>
  </div>

  <!-- Filters -->
  <div class="filters">
    <div class="filter-row">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="searchBox" placeholder="חיפוש לפי שם / טלפון / דגם / תקלה / טופס...">
      </div>
      <select class="sort" id="sortSel">
        <option value="recent">חדש → ישן</option>
        <option value="oldest">ישן → חדש</option>
        <option value="charge-desc">חיוב גבוה → נמוך</option>
        <option value="charge-asc">חיוב נמוך → גבוה</option>
        <option value="name">לפי שם</option>
        <option value="waiting">זמן המתנה ארוך ביותר</option>
      </select>
    </div>
    <div class="chips" id="chipsRow"></div>
  </div>

  <div class="results-meta">
    <div><b id="resCount">0</b> תוצאות</div>
    <div id="resNote"></div>
  </div>

  <!-- Grid -->
  <div class="grid" id="grid"></div>
  <div class="empty hidden" id="empty">
    <div class="big">🔍</div>
    <div>לא נמצאו תיקונים העונים על הסינון</div>
  </div>

</div>


<div id="installOverlay" class="install-overlay hidden">
  <div class="install-card">
    <button class="install-close" onclick="dismissInstallPopup(true)" aria-label="סגור">×</button>
    <div class="install-logo">CP</div>
    <div class="install-title">ComPhone Lab</div>
    <div class="install-subtitle">התקן את האפליקציה במסך הבית לגישה מהירה ושליחת וואטסאפ ללקוחות</div>
    <ul class="install-features">
      <li><span class="ico">⚡</span> טעינה מהירה כמו אפליקציה</li>
      <li><span class="ico">📲</span> מסך מלא ללא שורת כתובת</li>
      <li><span class="ico">🔔</span> גישה מהירה לניהול תיקונים</li>
      <li><span class="ico">💬</span> שליחת וואטסאפ בלחיצה</li>
    </ul>
    <button class="install-btn" id="installBtn" onclick="triggerInstall()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
      <span id="installBtnText">התקן עכשיו</span>
    </button>
    <button class="install-skip" onclick="dismissInstallPopup(false)">אולי אחר כך</button>

    <div class="install-ios-steps" id="iosSteps">
      <div style="margin-bottom:8px;"><b>להתקנה ב-iPhone/iPad:</b></div>
      <div class="step"><span class="num">1</span><span>לחץ על <b>שתף</b> <svg style="vertical-align:middle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> בתחתית המסך</span></div>
      <div class="step"><span class="num">2</span><span>גלול ובחר <b>הוסף למסך הבית</b></span></div>
      <div class="step"><span class="num">3</span><span>לחץ <b>הוסף</b> בפינה העליונה</span></div>
    </div>
  </div>
</div>

<div id="modalRoot"></div>
<div id="toastRoot"></div>

<!-- ============================================= -->
<!-- DATA: Loaded from Cloudflare Worker -->
<script>
window.REPAIRS_DATA = []; // Will be populated from the Worker
</script>

<!-- ============================================= -->
<!-- APP LOGIC                                     -->
<!-- ============================================= -->
<script>
'use strict';

// ========== State ==========
const state = {
  repairs: [],
  filter: 'all',
  search: '',
  sort: 'recent',
  sentLog: [],  // mirrors Worker's log
  template: null,
  config: {
    mode: 'wame',
    phoneNumberId: '',
    accessToken: '',
    templateName: '',
    languageCode: 'he',
    useTemplate: false,
    businessName: 'ComPhone',
    businessHours: "א'–ה' 09:00–19:00 · ו' 09:00–13:00",
    businessAddress: '',
  },
  // ----- Worker connection -----
  worker: {
    url:     localStorage.getItem('workerUrl') || window.location.origin,
    adminKey: localStorage.getItem('adminKey') || '',
    connected: false,
    lastSync: null,
    syncing: false,
  },
};

const DEFAULT_TEMPLATE = \`היי {name} 👋

המכשיר שלך *{device}* מוכן לאיסוף במעבדת {business} 🔧✨

📋 *פירוט התיקון*
• התקלה: {issue}
• הפתרון: {fixed}
• מס' טופס: {form}

💰 *לתשלום:* {price} ₪

🕐 שעות פעילות: {hours}

נשמח לראותך!
צוות {business}\`;

state.template = DEFAULT_TEMPLATE;

// ========== Helpers ==========
const STATUS_COLORS = {
  'תוקן': { cls: 'warn', label: 'תוקן · ממתין לאיסוף' },
  'נמסר ללקוח': { cls: 'success', label: 'נמסר ללקוח' },
  'מושבת': { cls: 'danger', label: 'מושבת' },
  'ממתין': { cls: 'muted', label: 'ממתין' },
  'ממתין לתשובה מלקוח': { cls: 'purple', label: 'ממתין לתשובה' },
};

const statusLabel = (s) => (STATUS_COLORS[s] && STATUS_COLORS[s].label) || s || 'ללא סטטוס';

function formatPhoneDisplay(p) {
  if (!p) return '—';
  const s = String(p).replace(/\\D/g, '');
  if (s.length === 10) return s.slice(0,3) + '-' + s.slice(3,6) + '-' + s.slice(6);
  return s;
}

function formatPhoneIntl(p) {
  if (!p) return null;
  let s = String(p).replace(/\\D/g, '');
  if (s.startsWith('972')) return s;
  if (s.startsWith('0')) s = s.slice(1);
  return '972' + s;
}

function parseDate(s) {
  if (!s) return null;
  // formats: "dd/mm/yyyy" or "dd/mm/yyyy hh:mm"
  const m = String(s).match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2}))?/);
  if (!m) return null;
  const [_, dd, mm, yy, hh = '0', mi = '0'] = m;
  return new Date(+yy, +mm - 1, +dd, +hh, +mi);
}

function formatMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return '₪' + Number(n).toLocaleString('he-IL');
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fillTemplate(tpl, r) {
  const business = state.config.businessName || 'ComPhone';
  const hours = state.config.businessHours || '';
  const address = state.config.businessAddress || '';
  const price = (r.charge && r.charge > 0) ? Number(r.charge).toLocaleString('he-IL') : '—';
  return tpl
    .replace(/\\{name\\}/g, r.name || 'לקוח יקר')
    .replace(/\\{device\\}/g, r.device || '—')
    .replace(/\\{issue\\}/g, (r.issue || '—').replace(/\\n/g, ' '))
    .replace(/\\{fixed\\}/g, (r.fixed || 'בוצע טיפול במעבדה').replace(/\\n/g, ' '))
    .replace(/\\{form\\}/g, r.form || '—')
    .replace(/\\{price\\}/g, price)
    .replace(/\\{phone\\}/g, formatPhoneDisplay(r.phone))
    .replace(/\\{received\\}/g, r.received || '—')
    .replace(/\\{status\\}/g, r.status || '—')
    .replace(/\\{business\\}/g, business)
    .replace(/\\{hours\\}/g, hours)
    .replace(/\\{address\\}/g, address);
}

function isSent(r) {
  return state.sentLog.some(x => x.form === r.form);
}

// ========== Stats ==========
function renderStats() {
  const all = state.repairs;
  const needsWA = all.filter(r => r.status === 'תוקן').length;
  const delivered = all.filter(r => r.status === 'נמסר ללקוח').length;
  const revenue = all.reduce((s, r) => s + (Number(r.charge) || 0), 0);
  document.getElementById('sTotal').textContent = all.length;
  document.getElementById('sTotalSub').textContent =
    'מתוך ' + all.length + ' רשומות';
  document.getElementById('sNeedsWA').textContent = needsWA;
  document.getElementById('sDelivered').textContent = delivered;
  document.getElementById('sDeliveredSub').textContent =
    Math.round((delivered / Math.max(all.length, 1)) * 100) + '% מכלל התיקונים';
  document.getElementById('sRevenue').textContent = formatMoney(revenue);
}

// ========== Chips ==========
function renderChips() {
  const row = document.getElementById('chipsRow');
  const counts = { all: state.repairs.length };
  const order = ['all', 'תוקן', 'ממתין', 'מושבת', 'ממתין לתשובה מלקוח', 'נמסר ללקוח'];
  for (const r of state.repairs) {
    counts[r.status || ''] = (counts[r.status || ''] || 0) + 1;
  }
  row.innerHTML = '';
  for (const key of order) {
    const count = counts[key] || 0;
    if (key !== 'all' && count === 0) continue;
    const label = key === 'all' ? 'הכל' : statusLabel(key);
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.filter === key ? ' active' : '');
    chip.innerHTML = escapeHtml(label) + ' <span class="count">' + count + '</span>';
    chip.onclick = () => { state.filter = key; render(); };
    row.appendChild(chip);
  }
}

// ========== Filter + Sort ==========
function getVisible() {
  let list = state.repairs;
  if (state.filter !== 'all') {
    list = list.filter(r => (r.status || '') === state.filter);
  }
  const q = state.search.trim().toLowerCase();
  if (q) {
    list = list.filter(r => {
      const hay = [r.name, r.phone, r.device, r.issue, r.fixed, r.form, r.imei]
        .map(x => (x == null ? '' : String(x).toLowerCase())).join(' ');
      return hay.includes(q);
    });
  }
  const byDate = (r) => parseDate(r.delivered) || parseDate(r.received) || new Date(0);
  const copy = list.slice();
  switch (state.sort) {
    case 'recent': copy.sort((a,b) => byDate(b) - byDate(a)); break;
    case 'oldest': copy.sort((a,b) => byDate(a) - byDate(b)); break;
    case 'charge-desc': copy.sort((a,b) => (b.charge||0) - (a.charge||0)); break;
    case 'charge-asc': copy.sort((a,b) => (a.charge||0) - (b.charge||0)); break;
    case 'name': copy.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'he')); break;
    case 'waiting': copy.sort((a,b) => (b.waitDays||0) - (a.waitDays||0)); break;
  }
  return copy;
}

// ========== Cards ==========
function renderGrid() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const list = getVisible();

  document.getElementById('resCount').textContent = list.length;
  const sent = state.sentLog.length;
  document.getElementById('resNote').textContent =
    sent > 0 ? ('נשלחו ' + sent + ' הודעות בסשן זה') : '';

  if (list.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  for (const r of list) {
    const card = document.createElement('div');
    card.className = 'card';
    if (r.status === 'תוקן' && !isSent(r)) card.classList.add('needs-wa');
    card.setAttribute('data-s', r.status || '');
    card.onclick = () => openDetail(r);

    const status = r.status || 'ללא סטטוס';
    const statusClass = 's-' + (status.replace(/\\s+/g, '_'));

    const senterBy = r.receivedBy ? ('התקבל ע"י ' + r.receivedBy) : '';
    const received = r.received || '';
    const metaBits = [];
    if (received) metaBits.push(received);
    if (r.form) metaBits.push('טופס #' + r.form);
    if (r.waitDays != null && r.waitDays > 0) metaBits.push(r.waitDays + ' ימי המתנה');

    card.innerHTML =
      '<div class="card-head">' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="card-name">' + escapeHtml(r.name || 'לקוח ללא שם') + '</div>' +
          '<div class="card-meta">' +
            metaBits.map(b => '<span>' + escapeHtml(b) + '</span>').join('<span class="dot">·</span>') +
          '</div>' +
        '</div>' +
        '<span class="status-pill ' + statusClass + '">' + escapeHtml(statusLabel(status)) + '</span>' +
      '</div>' +
      '<div class="card-device">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/></svg>' +
        escapeHtml(r.device || 'לא צוין') +
      '</div>' +
      (r.issue ? '<div class="field clip"><div class="k">תקלה</div><div class="v">' + escapeHtml(r.issue) + '</div></div>' : '') +
      (r.fixed ? '<div class="field clip"><div class="k">מה תוקן</div><div class="v">' + escapeHtml(r.fixed) + '</div></div>' : '') +
      '<div class="card-foot">' +
        '<div class="price' + ((r.charge||0) === 0 ? ' zero' : '') + '">' +
          '<span class="cur">₪</span>' + (r.charge != null ? Number(r.charge).toLocaleString('he-IL') : '0') +
        '</div>' +
        (r.phone
          ? ('<button class="wa-btn ' + (isSent(r) ? 'sent' : '') + '" onclick="event.stopPropagation();openDetail(REPAIRS_DATA.find(x=>x.form===' + (r.form || 'null') + '))">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.19 1.6 6.02L0 24l6.2-1.63A11.93 11.93 0 0 0 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0z"/></svg>' +
              (isSent(r) ? 'נשלח' : 'וואטסאפ') +
            '</button>')
          : '<div style="font-size:11.5px;color:var(--ink-3);">אין טלפון</div>') +
      '</div>';

    frag.appendChild(card);
  }
  grid.innerHTML = '';
  grid.appendChild(frag);
}

// ========== Master render ==========
function render() {
  renderStats();
  renderChips();
  renderGrid();
  updateModeBanner();
  updateLogBadge();
}

function updateModeBanner() {
  const m = state.config.mode;
  document.getElementById('modeText').textContent =
    m === 'meta' ? 'Meta WhatsApp API' : 'wa.me (פתיחה ידנית)';
  const pill = document.getElementById('modePill');
  pill.textContent = m === 'meta' ? 'אוטומטי' : 'ידני';
  pill.classList.toggle('live', m === 'meta');
}

function updateLogBadge() {
  const badge = document.getElementById('logBadge');
  const n = state.sentLog.length;
  if (n > 0) { badge.textContent = n; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

// ========== Toast ==========
function toast(msg, ms = 2400) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ========== Modals ==========
function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}
function openModalHTML(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = '<div class="overlay" onclick="if(event.target===this)closeModal()">' + html + '</div>';
}

// ----- Detail + WhatsApp preview -----
function openDetail(r) {
  if (!r) return;
  const msg = fillTemplate(state.template, r);
  const already = isSent(r);
  const intl = formatPhoneIntl(r.phone);
  const waLink = intl ? ('https://wa.me/' + intl + '?text=' + encodeURIComponent(msg)) : '#';

  const detailFields = [
    ['שם לקוח', r.name],
    ['טלפון', formatPhoneDisplay(r.phone)],
    ['דגם מכשיר', r.device],
    ['סטטוס', statusLabel(r.status)],
    ['מס\\' טופס', r.form],
    ['IMEI', r.imei],
    ['תאריך קבלה', r.received],
    ['תאריך מסירה', r.delivered],
    ['ימי המתנה', r.waitDays],
    ['שעות במעבדה', r.labHours],
    ['חיוב', formatMoney(r.charge)],
    ['סכום חלקים', formatMoney(r.parts)],
  ].filter(([_, v]) => v != null && v !== '');

  const fieldsHtml = detailFields.map(([k, v]) =>
    '<div class="field"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(v) + '</div></div>'
  ).join('');

  const longFields = [
    ['תקלה', r.issue],
    ['מה תוקן', r.fixed],
    ['מלל פנימי', r.internal],
  ].filter(([_, v]) => v != null && v !== '')
   .map(([k, v]) =>
    '<div class="field wide"><div class="k">' + escapeHtml(k) + '</div><div class="v">' + escapeHtml(v) + '</div></div>'
  ).join('');

  const modeInfo = state.config.mode === 'meta'
    ? '<div style="font-size:12px;color:var(--ink-3);margin-top:8px;">ישלח דרך Meta WhatsApp API' + (state.config.useTemplate && state.config.templateName ? (' בתבנית "' + escapeHtml(state.config.templateName) + '"') : ' כהודעת טקסט חופשי (מתאים ב-24 שעות מפנייה אחרונה של הלקוח)') + '</div>'
    : '<div style="font-size:12px;color:var(--ink-3);margin-top:8px;">ייפתח חלון וואטסאפ עם ההודעה מוכנה לשליחה</div>';

  const sendBtn = state.config.mode === 'meta'
    ? '<button class="btn btn-primary" onclick="sendViaAPI(' + (r.form || 'null') + ')">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.19 1.6 6.02L0 24l6.2-1.63A11.93 11.93 0 0 0 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0z"/></svg>' +
        'שלח דרך Meta API' +
      '</button>'
    : '<a class="btn btn-primary" href="' + waLink + '" target="_blank" onclick="markSent(' + (r.form || 'null') + ',\\'wame\\')">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.19 1.6 6.02L0 24l6.2-1.63A11.93 11.93 0 0 0 12 24c6.63 0 12-5.37 12-12S18.63 0 12 0z"/></svg>' +
        'פתח בוואטסאפ' +
      '</a>';

  openModalHTML(
    '<div class="modal wide">' +
      '<div class="modal-head">' +
        '<div>' +
          '<h2>' + escapeHtml(r.name || 'לקוח') + ' · ' + escapeHtml(r.device || '') + '</h2>' +
          '<div class="sub">טופס #' + (r.form || '—') + ' · ' + escapeHtml(statusLabel(r.status)) + (already ? ' · נשלח כבר בסשן זה' : '') + '</div>' +
        '</div>' +
        '<button class="close-btn" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="detail-grid">' + fieldsHtml + longFields + '</div>' +
        '<div class="preview-label">' +
          '<span>תצוגה מקדימה של ההודעה</span>' +
          '<span class="chars" id="msgChars">' + msg.length + ' תווים</span>' +
        '</div>' +
        '<div class="preview-box">' +
          '<textarea id="msgArea" oninput="document.getElementById(\\'msgChars\\').textContent=this.value.length+\\' תווים\\'">' + escapeHtml(msg) + '</textarea>' +
        '</div>' +
        modeInfo +
        '<div class="modal-actions">' +
          sendBtn +
          (r.status !== 'תוקן' && r.status !== 'נמסר ללקוח'
            ? '<button class="btn" style="background:#ea580c;color:white;" onclick="openCloseFix(' + (r.form || 'null') + ')">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
                'סגור תיקון' +
              '</button>'
            : '') +
          '<button class="btn btn-secondary" onclick="copyMessage()">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
            'העתק הודעה' +
          '</button>' +
          (already
            ? '<button class="btn btn-ghost" onclick="unmarkSent(' + (r.form || 'null') + ')">בטל סימון נשלח</button>'
            : '<button class="btn btn-ghost" onclick="markSent(' + (r.form || 'null') + ',\\'manual\\')">סמן כנשלח ידנית</button>'
          ) +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function copyMessage() {
  const area = document.getElementById('msgArea');
  if (!area) return;
  area.select();
  area.setSelectionRange(0, 99999);
  try { navigator.clipboard.writeText(area.value); toast('ההודעה הועתקה ללוח'); }
  catch { document.execCommand('copy'); toast('ההודעה הועתקה'); }
}

function markSent(formNum, method) {
  const r = state.repairs.find(x => x.form === formNum);
  if (!r) return;
  if (isSent(r)) return;
  state.sentLog.unshift({
    form: r.form, name: r.name, phone: r.phone, device: r.device,
    method: method || 'manual', ts: Date.now(),
  });
  render();
  toast('סומן כנשלח');
  // Re-open detail if modal is open
  const mr = document.getElementById('modalRoot');
  if (mr.innerHTML) { closeModal(); setTimeout(() => openDetail(r), 50); }
}

function unmarkSent(formNum) {
  state.sentLog = state.sentLog.filter(x => x.form !== formNum);
  const r = state.repairs.find(x => x.form === formNum);
  render();
  toast('הוסר מהיומן');
  const mr = document.getElementById('modalRoot');
  if (mr.innerHTML && r) { closeModal(); setTimeout(() => openDetail(r), 50); }
}

// ----- Send via Meta API -----
async function sendViaAPI(formNum) {
  const r = state.repairs.find(x => x.form === formNum);
  if (!r) return;
  const cfg = state.config;
  if (!cfg.phoneNumberId || !cfg.accessToken) {
    toast('יש להגדיר Phone Number ID ו-Access Token בהגדרות');
    return;
  }
  const area = document.getElementById('msgArea');
  const msg = area ? area.value : fillTemplate(state.template, r);
  const to = formatPhoneIntl(r.phone);
  if (!to) { toast('מספר טלפון לא תקין'); return; }

  const url = 'https://graph.facebook.com/v21.0/' + cfg.phoneNumberId + '/messages';
  let body;
  if (cfg.useTemplate && cfg.templateName) {
    body = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: cfg.templateName,
        language: { code: cfg.languageCode || 'he' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: r.name || 'לקוח' },
            { type: 'text', text: r.device || '—' },
            { type: 'text', text: (r.charge && r.charge > 0) ? String(r.charge) : '0' },
            { type: 'text', text: String(r.form || '—') },
          ],
        }],
      },
    };
  } else {
    body = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: msg },
    };
  }

  toast('שולח...');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      markSent(formNum, 'api');
      toast('נשלח בהצלחה ✓');
      closeModal();
    } else {
      const errMsg = (data && data.error && data.error.message) || 'שגיאה לא ידועה';
      toast('שגיאה: ' + errMsg, 5000);
      console.error('WA send error:', data);
    }
  } catch (e) {
    toast('שגיאת רשת: ' + e.message, 5000);
  }
}

// ----- Template Editor -----
function openTemplateEditor() {
  const sample = state.repairs.find(r => r.status === 'תוקן') || state.repairs[0];
  const preview = sample ? fillTemplate(state.template, sample) : '';

  openModalHTML(
    '<div class="modal wide">' +
      '<div class="modal-head">' +
        '<div>' +
          '<h2>עריכת תבנית הודעה</h2>' +
          '<div class="sub">משתנים זמינים - לחיצה תוסיף אותם לתבנית</div>' +
        '</div>' +
        '<button class="close-btn" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="form-field">' +
          '<label>תבנית ההודעה</label>' +
          '<textarea id="tplArea" rows="12" oninput="refreshTplPreview()">' + escapeHtml(state.template) + '</textarea>' +
          '<div class="var-chips">' +
            ['name','device','issue','fixed','form','price','phone','received','status','business','hours','address']
              .map(v => '<button class="var-chip" onclick="insertVar(\\'' + v + '\\')">{' + v + '}</button>').join('') +
          '</div>' +
          '<div class="hint">הטקסט בתוך *כוכביות* יוצג מודגש בוואטסאפ</div>' +
        '</div>' +
        '<div class="preview-label">' +
          '<span>תצוגה מקדימה (' + (sample ? escapeHtml(sample.name) : 'אין דוגמה') + ')</span>' +
        '</div>' +
        '<div class="preview-box">' +
          '<div id="tplPreview" style="white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.55;">' + escapeHtml(preview) + '</div>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-primary" style="background:var(--brand);" onclick="saveTemplate()">שמור תבנית</button>' +
          '<button class="btn btn-secondary" onclick="resetTemplate()">אפס לברירת מחדל</button>' +
          '<button class="btn btn-ghost" onclick="closeModal()">ביטול</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}
window.insertVar = function(v) {
  const area = document.getElementById('tplArea');
  const pos = area.selectionStart;
  const txt = '{' + v + '}';
  area.value = area.value.slice(0, pos) + txt + area.value.slice(area.selectionEnd);
  area.focus();
  area.setSelectionRange(pos + txt.length, pos + txt.length);
  refreshTplPreview();
};
window.refreshTplPreview = function() {
  const area = document.getElementById('tplArea');
  const sample = state.repairs.find(r => r.status === 'תוקן') || state.repairs[0];
  if (!sample || !area) return;
  const rendered = fillTemplate(area.value, sample);
  document.getElementById('tplPreview').textContent = rendered;
};
window.saveTemplate = function() {
  const area = document.getElementById('tplArea');
  state.template = area.value;
  closeModal();
  toast('התבנית נשמרה');
};
window.resetTemplate = function() {
  document.getElementById('tplArea').value = DEFAULT_TEMPLATE;
  refreshTplPreview();
};

// ----- Settings -----
function openSettings() {
  const c = state.config;
  openModalHTML(
    '<div class="modal">' +
      '<div class="modal-head">' +
        '<div>' +
          '<h2>הגדרות שליחה</h2>' +
          '<div class="sub">בחרי את אופן השליחה של הודעות הוואטסאפ</div>' +
        '</div>' +
        '<button class="close-btn" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="tabs">' +
          '<button class="tab ' + (c.mode === 'wame' ? 'active' : '') + '" onclick="cfgMode(\\'wame\\')">wa.me (ידני)</button>' +
          '<button class="tab ' + (c.mode === 'meta' ? 'active' : '') + '" onclick="cfgMode(\\'meta\\')">Meta API (אוטומטי)</button>' +
        '</div>' +
        '<div id="cfgBody"></div>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-primary" style="background:var(--brand);" onclick="saveSettings()">שמור הגדרות</button>' +
          '<button class="btn btn-ghost" onclick="closeModal()">ביטול</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
  renderCfgBody();
}
window.cfgMode = function(mode) {
  state.config.mode = mode;
  openSettings();
};
function renderCfgBody() {
  const c = state.config;
  const body = document.getElementById('cfgBody');
  if (!body) return;
  if (c.mode === 'wame') {
    body.innerHTML =
      '<p style="font-size:13px;color:var(--ink-2);margin-bottom:14px;line-height:1.5;">' +
        'במצב זה לחיצה על "פתח בוואטסאפ" תפתח חלון וואטסאפ חדש עם ההודעה מוכנה. ' +
        'מתאים לשליחה מהטלפון - במיוחד אם אין לך עדיין גישה ל-Meta Business API.' +
      '</p>' +
      '<div class="form-field">' +
        '<label>שם העסק (להכנסה בתבנית)</label>' +
        '<input id="cfgBusinessName" value="' + escapeHtml(c.businessName) + '">' +
      '</div>' +
      '<div class="form-field">' +
        '<label>שעות פעילות</label>' +
        '<input id="cfgBusinessHours" value="' + escapeHtml(c.businessHours) + '">' +
      '</div>' +
      '<div class="form-field">' +
        '<label>כתובת (אופציונלי)</label>' +
        '<input id="cfgBusinessAddress" value="' + escapeHtml(c.businessAddress) + '" placeholder="למשל: רחוב הרצל 10, פתח תקווה">' +
      '</div>';
  } else {
    body.innerHTML =
      '<p style="font-size:13px;color:var(--ink-2);margin-bottom:14px;line-height:1.5;">' +
        'שליחה ישירות דרך Meta WhatsApp Cloud API. דורש: WhatsApp Business Account מאומת, Phone Number ID, ו-Access Token.' +
      '</p>' +
      '<div class="form-field">' +
        '<label>Phone Number ID</label>' +
        '<input id="cfgPNID" value="' + escapeHtml(c.phoneNumberId) + '" placeholder="123456789012345">' +
        '<div class="hint">נמצא ב-Meta Developers → WhatsApp → API Setup</div>' +
      '</div>' +
      '<div class="form-field">' +
        '<label>Access Token</label>' +
        '<input id="cfgToken" type="password" value="' + escapeHtml(c.accessToken) + '" placeholder="EAAxxxx...">' +
        '<div class="hint">מומלץ להשתמש ב-Permanent Token של System User</div>' +
      '</div>' +
      '<div class="form-field">' +
        '<label>' +
          '<input type="checkbox" id="cfgUseTemplate" ' + (c.useTemplate ? 'checked' : '') + ' onchange="document.getElementById(\\'tplFields\\').style.display=this.checked?\\'block\\':\\'none\\'" style="width:auto;margin-left:6px;vertical-align:middle;">' +
          'שלח כ-Template (נדרש מחוץ לחלון 24 שעות)' +
        '</label>' +
      '</div>' +
      '<div id="tplFields" style="display:' + (c.useTemplate ? 'block' : 'none') + ';">' +
        '<div class="form-field">' +
          '<label>Template Name</label>' +
          '<input id="cfgTName" value="' + escapeHtml(c.templateName) + '" placeholder="repair_ready_notification">' +
        '</div>' +
        '<div class="form-field">' +
          '<label>Language Code</label>' +
          '<input id="cfgLang" value="' + escapeHtml(c.languageCode) + '" placeholder="he">' +
        '</div>' +
        '<div class="hint" style="margin-bottom:12px;">התבנית צריכה לקבל 4 משתנים לפי סדר: שם, דגם, מחיר, מספר טופס</div>' +
      '</div>' +
      '<div class="form-field">' +
        '<label>שם העסק</label>' +
        '<input id="cfgBusinessName" value="' + escapeHtml(c.businessName) + '">' +
      '</div>' +
      '<div class="form-field">' +
        '<label>שעות פעילות</label>' +
        '<input id="cfgBusinessHours" value="' + escapeHtml(c.businessHours) + '">' +
      '</div>';
  }
}
window.saveSettings = function() {
  const c = state.config;
  const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const gc = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
  c.businessName = g('cfgBusinessName') || c.businessName;
  c.businessHours = g('cfgBusinessHours') || c.businessHours;
  if (document.getElementById('cfgBusinessAddress')) c.businessAddress = g('cfgBusinessAddress');
  if (c.mode === 'meta') {
    c.phoneNumberId = g('cfgPNID').trim();
    c.accessToken = g('cfgToken').trim();
    c.useTemplate = gc('cfgUseTemplate');
    c.templateName = g('cfgTName').trim();
    c.languageCode = g('cfgLang').trim() || 'he';
  }
  closeModal();
  render();
  toast('ההגדרות נשמרו');
};

// ----- Log Viewer -----
function openLog() {
  const items = state.sentLog;
  const body = items.length === 0
    ? '<div class="empty"><div class="big">📭</div><div>עדיין לא נשלחו הודעות בסשן זה</div></div>'
    : items.map(x => {
        const when = new Date(x.ts).toLocaleString('he-IL');
        const method = x.method === 'api' ? 'API' : x.method === 'wame' ? 'wa.me' : 'ידני';
        return '<div class="log-item">' +
          '<div>' +
            '<div style="font-weight:600;">' + escapeHtml(x.name || 'לקוח') + ' · ' + escapeHtml(x.device || '') + '</div>' +
            '<div style="font-size:11.5px;color:var(--ink-3);margin-top:2px;">טופס #' + (x.form || '—') + ' · ' + formatPhoneDisplay(x.phone) + '</div>' +
          '</div>' +
          '<div style="text-align:left;">' +
            '<div class="log-method ' + (x.method === 'api' ? 'api' : '') + '">' + method + '</div>' +
            '<div class="when" style="margin-top:3px;">' + when + '</div>' +
          '</div>' +
        '</div>';
      }).join('');

  openModalHTML(
    '<div class="modal">' +
      '<div class="modal-head">' +
        '<div>' +
          '<h2>יומן שליחות</h2>' +
          '<div class="sub">היסטוריה בסשן הנוכחי · ' + items.length + ' הודעות</div>' +
        '</div>' +
        '<button class="close-btn" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' + body +
        (items.length > 0 ? '<div class="modal-actions"><button class="btn btn-secondary" onclick="clearLog()">נקה יומן</button><button class="btn btn-ghost" onclick="closeModal()">סגור</button></div>' : '') +
      '</div>' +
    '</div>'
  );
}
window.clearLog = function() {
  if (confirm('לנקות את כל יומן השליחות?')) {
    state.sentLog = [];
    render();
    closeModal();
  }
};

// ========== Worker API ==========
function workerHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Key': state.worker.adminKey,
  };
}

async function workerFetch(path, options = {}) {
  if (!state.worker.url || !state.worker.adminKey) {
    throw new Error('Worker לא מוגדר - לחצי על "חיבור ל-Worker"');
  }
  const url = state.worker.url.replace(/\\/$/, '') + path;
  const res = await fetch(url, {
    ...options,
    headers: { ...workerHeaders(), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || \`HTTP \${res.status}\`);
  return data;
}

async function loadFromWorker() {
  state.worker.syncing = true;
  updateSyncIndicator();
  try {
    const [repData, logData, cfgData] = await Promise.all([
      workerFetch('/api/repairs'),
      workerFetch('/api/wa/log'),
      workerFetch('/api/config'),
    ]);
    state.repairs = repData.repairs || [];
    state.sentLog = logData.log || [];
    const cfg = cfgData.config || {};
    state.template = cfg.template || state.template;
    if (cfg.businessName)    state.config.businessName = cfg.businessName;
    if (cfg.businessHours)   state.config.businessHours = cfg.businessHours;
    if (cfg.businessAddress) state.config.businessAddress = cfg.businessAddress;
    if (cfg.sendMode === 'meta' && cfg.phoneNumberId) state.config.mode = 'meta';
    state.worker.connected = true;
    state.worker.lastSync = repData.lastSync || Date.now();
    window.REPAIRS_DATA = state.repairs; // legacy pointer for onclick handlers
    render();
    toast('נטענו ' + state.repairs.length + ' תיקונים מה-Worker');
  } catch (e) {
    state.worker.connected = false;
    toast('שגיאה בטעינה: ' + e.message, 4000);
  } finally {
    state.worker.syncing = false;
    updateSyncIndicator();
  }
}

function updateSyncIndicator() {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  const w = state.worker;
  if (w.syncing) {
    el.className = 'sync-dot syncing';
    el.title = 'מסתנכרן...';
  } else if (w.connected) {
    el.className = 'sync-dot online';
    el.title = 'מחובר · עדכון אחרון: ' + (w.lastSync ? new Date(w.lastSync).toLocaleString('he-IL') : '—');
  } else {
    el.className = 'sync-dot offline';
    el.title = 'לא מחובר ל-Worker';
  }
}

// Replace sendViaAPI: now routes through Worker
async function sendViaAPI(formNum) {
  const r = state.repairs.find(x => x.form === formNum);
  if (!r) return;
  const area = document.getElementById('msgArea');
  const msg = area ? area.value : fillTemplate(state.template, r);
  toast('שולח דרך Worker...');
  try {
    const res = await workerFetch('/api/wa/send', {
      method: 'POST',
      body: JSON.stringify({ form: r.form, to: r.phone, message: msg }),
    });
    if (res.ok) {
      toast('נשלח ✓');
      closeModal();
      await loadFromWorker();
    } else {
      toast('שגיאה: ' + (res.error || 'unknown'), 5000);
    }
  } catch (e) {
    toast('שגיאה: ' + e.message, 5000);
  }
}
window.sendViaAPI = sendViaAPI;

// Override markSent / unmarkSent to also sync with Worker
const _origMarkSent = markSent;
window.markSent = async function(formNum, method) {
  _origMarkSent(formNum, method);
  if (state.worker.connected && method !== 'api') {
    const r = state.repairs.find(x => x.form === formNum);
    if (r) {
      try {
        await workerFetch('/api/wa/log', {
          method: 'POST',
          body: JSON.stringify({
            form: r.form, name: r.name, phone: r.phone,
            device: r.device, method: method || 'manual',
          }),
        });
      } catch (e) { console.warn('Failed to sync log:', e); }
    }
  }
};

// ========== Worker Connection UI ==========
function openWorkerConnect() {
  const w = state.worker;
  openModalHTML(
    '<div class="modal">' +
      '<div class="modal-head">' +
        '<div>' +
          '<h2>חיבור ל-Worker</h2>' +
          '<div class="sub">הגדרת כתובת ה-Worker ומפתח אדמין</div>' +
        '</div>' +
        '<button class="close-btn" onclick="closeModal()">&times;</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="form-field">' +
          '<label>Worker URL</label>' +
          '<input id="wkUrl" value="' + (w.url || '') + '" placeholder="https://comphone-lab.bnaya-av.workers.dev" dir="ltr">' +
        '</div>' +
        '<div class="form-field">' +
          '<label>Admin Key</label>' +
          '<input id="wkKey" type="password" value="' + (w.adminKey || '') + '" placeholder="מפתח האדמין שהגדרת ב-wrangler secret" dir="ltr">' +
        '</div>' +
        '<div class="form-field">' +
          '<div style="font-size:12.5px;color:var(--ink-3);line-height:1.6;">' +
            'סטטוס: ' +
            (w.connected
              ? '<b style="color:var(--success);">מחובר</b> · ' + state.repairs.length + ' תיקונים'
              : '<b style="color:var(--danger);">לא מחובר</b>') +
          '</div>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-primary" style="background:var(--brand);" onclick="saveWorkerConfig()">שמור והתחבר</button>' +
          '<button class="btn btn-ghost" onclick="closeModal()">ביטול</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}
window.saveWorkerConfig = async function() {
  const url = document.getElementById('wkUrl').value.trim();
  const key = document.getElementById('wkKey').value.trim();
  if (!url || !key) { toast('שני השדות נדרשים'); return; }
  state.worker.url = url;
  state.worker.adminKey = key;
  localStorage.setItem('workerUrl', url);
  localStorage.setItem('adminKey', key);
  closeModal();
  await loadFromWorker();
};

// ========== Close Fix (queue to cashier script) ==========
window.openCloseFix = function(formNum) {
  const r = state.repairs.find(x => x.form === formNum);
  if (!r) { toast('תיקון לא נמצא'); return; }
  closeModal();
  setTimeout(() => {
    const defaultAmount = r.charge && r.charge > 0 ? r.charge : '';
    openModalHTML(
      '<div class="modal">' +
        '<div class="modal-head">' +
          '<div>' +
            '<h2>סגירת תיקון #' + r.form + '</h2>' +
            '<div class="sub">' + escapeHtml(r.name || '') + ' · ' + escapeHtml(r.device || '') + '</div>' +
          '</div>' +
          '<button class="close-btn" onclick="closeModal()">&times;</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:10px 12px;border-radius:10px;font-size:12.5px;line-height:1.5;margin-bottom:14px;">' +
            '⚠️ הסקריפט במחשב הקופה יסגור את התיקון אוטומטית ב-NewOrder תוך מספר שניות.' +
          '</div>' +
          '<div class="form-field">' +
            '<label>סכום לתשלום (₪)</label>' +
            '<input id="closeAmount" type="number" value="' + defaultAmount + '" placeholder="250" inputmode="numeric">' +
            '<div class="hint">הסכום שייכנס לחיוב הלקוח (costwithtax)</div>' +
          '</div>' +
          '<div class="form-field">' +
            '<label>פעולות טכנאי</label>' +
            '<textarea id="closeNotes" rows="4" placeholder="לדוגמה: החלפת מסך + הדבקה">' + escapeHtml(r.fixed || '') + '</textarea>' +
            '<div class="hint">הטקסט שייכנס לשדה MemoTextBox ב-NewOrder</div>' +
          '</div>' +
          '<div class="modal-actions">' +
            '<button class="btn btn-primary" style="background:#ea580c;" onclick="submitCloseFix(' + r.form + ')">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 11l3 3L22 4"/></svg>' +
              'שלח לסקריפט הקופה' +
            '</button>' +
            '<button class="btn btn-ghost" onclick="closeModal()">ביטול</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }, 100);
};

window.submitCloseFix = async function(formNum) {
  const amountEl = document.getElementById('closeAmount');
  const notesEl  = document.getElementById('closeNotes');
  const amount = parseFloat(amountEl.value);
  const notes  = notesEl.value.trim();
  if (isNaN(amount) || amount < 0) { toast('סכום לא תקין'); return; }
  if (!notes) { toast('יש למלא פעולות טכנאי'); return; }

  toast('שולח לסקריפט הקופה...');
  try {
    const res = await workerFetch('/api/close-fix', {
      method: 'POST',
      body: JSON.stringify({
        fix_number: String(formNum),
        amount: amount,
        tech_notes: notes,
      }),
    });
    if (res.ok || res.queued) {
      closeModal();
      toast('✓ התיקון נשלח לתור. ממתין לסקריפט...');
      // Start polling for status
      pollFixStatus(formNum);
    } else {
      toast('שגיאה: ' + (res.error || 'unknown'), 4000);
    }
  } catch (e) {
    toast('שגיאה: ' + e.message, 4000);
  }
};

// Poll status until done/failed/timeout
async function pollFixStatus(formNum, attempts = 0) {
  if (attempts > 60) { // 60 attempts × 3s = 3 minutes
    toast('⏱ עבר זמן רב. בדוק ידנית ב-NewOrder.', 5000);
    return;
  }
  try {
    const res = await workerFetch('/api/fix-status/' + formNum);
    if (res.status === 'done') {
      toast('🎉 תיקון #' + formNum + ' נסגר בהצלחה ב-NewOrder!', 5000);
      setTimeout(() => loadFromWorker(), 2000);
      return;
    }
    if (res.status === 'failed') {
      toast('❌ סגירה נכשלה: ' + (res.error || 'unknown'), 6000);
      return;
    }
    // still pending
    setTimeout(() => pollFixStatus(formNum, attempts + 1), 3000);
  } catch (e) {
    setTimeout(() => pollFixStatus(formNum, attempts + 1), 3000);
  }
}


// ========== Init ==========
function init() {
  document.getElementById('searchBox').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderGrid();
  });
  document.getElementById('sortSel').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderGrid();
  });

  document.getElementById('btnSettings').onclick = openSettings;
  document.getElementById('btnSettings2').onclick = openSettings;
  document.getElementById('btnTemplate').onclick = openTemplateEditor;
  document.getElementById('btnTemplate2').onclick = openTemplateEditor;
  document.getElementById('btnLog').onclick = openLog;
  document.getElementById('btnWorker').onclick = openWorkerConnect;
  document.getElementById('btnRefresh').onclick = () => loadFromWorker();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  updateSyncIndicator();
  render();

  // Auto-connect if credentials stored
  if (state.worker.url && state.worker.adminKey) {
    loadFromWorker();
    // Auto-refresh every 2 minutes if connected
    setInterval(() => {
      if (state.worker.connected && !state.worker.syncing && !document.getElementById('modalRoot').innerHTML) {
        loadFromWorker();
      }
    }, 120000);
  } else {
    // Prompt for connection on first load
    setTimeout(openWorkerConnect, 300);
  }
}

init();


// ========== PWA Install Popup ==========
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  maybeShowInstallPopup();
});

window.addEventListener('appinstalled', () => {
  localStorage.setItem('pwaInstalled', '1');
  const ov = document.getElementById('installOverlay');
  if (ov) ov.classList.add('hidden');
});

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true
      || document.referrer.startsWith('android-app://');
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function maybeShowInstallPopup() {
  if (isStandalone() || localStorage.getItem('pwaInstalled') === '1') return;
  const dismissed = localStorage.getItem('installDismissed');
  // Re-prompt after 7 days if just skipped
  if (dismissed && Date.now() - Number(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

  const overlay = document.getElementById('installOverlay');
  if (!overlay) return;

  const btnText = document.getElementById('installBtnText');
  const iosSteps = document.getElementById('iosSteps');
  const installBtn = document.getElementById('installBtn');

  if (isIOS()) {
    if (btnText) btnText.textContent = 'הראה לי איך';
    if (installBtn) installBtn.onclick = () => {
      iosSteps?.classList.toggle('show');
    };
  } else if (!deferredPrompt) {
    // Other browsers without install support — show skip-only
    const android = /Android/i.test(navigator.userAgent);
    if (!android) return; // not mobile, likely desktop chrome etc - skip
  }

  overlay.classList.remove('hidden');
}

async function triggerInstall() {
  if (isIOS()) {
    document.getElementById('iosSteps')?.classList.toggle('show');
    return;
  }
  if (!deferredPrompt) {
    dismissInstallPopup(false);
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  if (outcome === 'accepted') {
    localStorage.setItem('pwaInstalled', '1');
  }
  document.getElementById('installOverlay')?.classList.add('hidden');
}

function dismissInstallPopup(permanent) {
  document.getElementById('installOverlay')?.classList.add('hidden');
  localStorage.setItem('installDismissed', String(Date.now()));
  if (permanent) localStorage.setItem('installDismissedPermanent', '1');
}

// Show popup on iOS after 3 seconds (it has no beforeinstallprompt event)
setTimeout(() => {
  if (isIOS() && !isStandalone()) maybeShowInstallPopup();
}, 3000);

// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

</script>
</body>
</html>
`;

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
// Pending fixes queue
// ====================================================================
// Flow:
// 1. PWA -> POST /api/close-fix       (admin auth) -> queues a fix to be closed
// 2. Cashier script -> GET /api/pending-fixes  (sync auth) -> fetches the queue
// 3. Cashier script -> DELETE /api/pending-fixes/:n?status=done|failed (sync auth)
// 4. PWA -> GET /api/fix-status/:n   (admin auth) -> shows result

async function apiCloseFix(request, env) {
  const gate = requireAdmin(request, env);
  if (gate) return err(gate, 401);

  let payload;
  try { payload = await request.json(); } catch { return err('Invalid JSON'); }

  const fixNumber = String(payload.fix_number || payload.form || '').trim();
  const amount    = Number(payload.amount);
  const techNotes = String(payload.tech_notes || '').trim();

  if (!fixNumber)             return err('Missing fix_number');
  if (isNaN(amount) || amount < 0) return err('Invalid amount');
  if (!techNotes)             return err('Missing tech_notes');

  // Check if already pending or recently processed
  const queue = await kvGet(env, 'pending:queue', {});
  if (queue[fixNumber]) {
    const existing = queue[fixNumber];
    if (existing.status === 'pending') {
      return err('Already in queue', 409, { existing });
    }
  }

  const id = crypto.randomUUID();
  const entry = {
    id,
    fix_number: fixNumber,
    amount,
    tech_notes: techNotes,
    status: 'pending',
    queued_at: Date.now(),
    queued_by: request.headers.get('cf-connecting-ip') || null,
  };

  queue[fixNumber] = entry;
  await kvPut(env, 'pending:queue', queue);

  return json({ ok: true, queued: true, id, entry });
}

async function apiGetPendingFixes(request, env) {
  const gate = requireSync(request, env);
  if (gate) return err(gate, 401);
  const queue = await kvGet(env, 'pending:queue', {});
  const pending = Object.values(queue).filter(e => e.status === 'pending');
  return json(pending);
}

async function apiDeletePendingFix(request, env, path) {
  const gate = requireSync(request, env);
  if (gate) return err(gate, 401);

  const fixNumber = decodeURIComponent(path.replace('/api/pending-fixes/', '').trim());
  if (!fixNumber) return err('Missing fix_number in path');

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'done';
  const error  = url.searchParams.get('error') || null;

  const queue = await kvGet(env, 'pending:queue', {});
  const entry = queue[fixNumber];
  if (!entry) return err('Not found in queue', 404);

  if (status === 'done' || status === 'success') {
    entry.status = 'done';
    entry.completed_at = Date.now();
    delete entry.error;

    // Optimistic update: mark the repair as 'תוקן' immediately in KV
    // so the PWA reflects the change without waiting for next NewOrder sync.
    try {
      const repairs = await kvGet(env, 'repairs:all', {});
      const formNum = Number(fixNumber);
      const repair = repairs[formNum] || repairs[fixNumber];
      if (repair) {
        const oldStatus = repair.status;
        repair.status = 'תוקן';
        if (entry.amount != null) repair.charge = entry.amount;
        if (entry.tech_notes)     repair.fixed = entry.tech_notes;
        repairs[repair.form] = repair;
        await kvPut(env, 'repairs:all', repairs);
        entry.optimistic_update = { from: oldStatus, to: 'תוקן' };

        // Auto-send WhatsApp if config allows and not already sent
        try {
          const cfg = await loadConfig(env);
          const sentLog = await kvGet(env, 'log:sent', []);
          const sentForms = new Set(sentLog.map(x => x.form));
          if (cfg.autoSend && cfg.sendMode === 'meta'
              && cfg.autoSendTriggers.includes('תוקן')
              && repair.phone && !sentForms.has(repair.form)) {
            const message = fillTemplate(cfg.template, repair, cfg);
            const waRes = await sendWhatsApp(cfg, repair.phone, message, repair);
            if (waRes.ok) {
              sentLog.unshift({
                form: repair.form,
                name: repair.name,
                phone: repair.phone,
                device: repair.device,
                method: 'auto-close',
                ts: Date.now(),
                messageId: waRes.messageId,
              });
              await kvPut(env, 'log:sent', sentLog.slice(0, 500));
              entry.whatsapp_sent = { ok: true, messageId: waRes.messageId };
            } else {
              entry.whatsapp_sent = { ok: false, error: waRes.error };
            }
          }
        } catch (waErr) {
          entry.whatsapp_sent = { ok: false, error: 'send error: ' + waErr.message };
        }
      }
    } catch (e) {
      // Don't fail the request if optimistic update fails - it'll catch up
      // on the next NewOrder sync run anyway.
      console.warn('Optimistic repair update failed:', e.message);
    }
  } else if (status === 'failed' || status === 'error') {
    entry.status = 'failed';
    entry.failed_at = Date.now();
    entry.error = error || 'Unknown error';
  } else {
    return err('Invalid status. Use done or failed');
  }

  queue[fixNumber] = entry;
  await kvPut(env, 'pending:queue', queue);

  // Cleanup old completed/failed entries (older than 7 days)
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let cleaned = 0;
  for (const [num, e] of Object.entries(queue)) {
    if (e.status !== 'pending' && (e.completed_at || e.failed_at || 0) < cutoff) {
      delete queue[num];
      cleaned++;
    }
  }
  if (cleaned > 0) await kvPut(env, 'pending:queue', queue);

  return json({ ok: true, status: entry.status, entry });
}

async function apiFixStatus(request, env, path) {
  const gate = requireAdmin(request, env);
  if (gate) return err(gate, 401);
  const fixNumber = decodeURIComponent(path.replace('/api/fix-status/', '').trim());
  if (!fixNumber) return err('Missing fix_number in path');
  const queue = await kvGet(env, 'pending:queue', {});
  const entry = queue[fixNumber];
  if (!entry) return json({ status: 'not_found', fix_number: fixNumber });
  return json(entry);
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
      if (p === '/' && m === 'GET') {
        return new Response(PWA_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
        });
      }
      if (p === '/manifest.json' && m === 'GET') {
        return new Response(JSON.stringify({
          name: 'ComPhone Lab - מעבדת תיקונים',
          short_name: 'ComPhone Lab',
          description: 'ניהול תיקוני מעבדה ושליחת וואטסאפ ללקוחות',
          start_url: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#f6f3ec',
          theme_color: '#0b3d3a',
          dir: 'rtl',
          lang: 'he',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        }), {
          headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
        });
      }
      if (p === '/sw.js' && m === 'GET') {
        const sw = `
          const CACHE = 'comphone-lab-v1';
          self.addEventListener('install', e => self.skipWaiting());
          self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
          self.addEventListener('fetch', e => {
            // Network first, fallback to cache (for offline)
            if (e.request.method !== 'GET') return;
            e.respondWith(
              fetch(e.request).then(r => {
                if (r.ok && e.request.url.startsWith(self.location.origin)) {
                  const clone = r.clone();
                  caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return r;
              }).catch(() => caches.match(e.request))
            );
          });
        `;
        return new Response(sw, {
          headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
        });
      }
            if (p === '/health' || p === '/api/health') {
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
      // Pending-fixes queue (PWA → script polling → NewOrder automation)
      if (p === '/api/close-fix'      && m === 'POST') return apiCloseFix(request, env);
      if (p === '/api/pending-fixes'  && m === 'GET')  return apiGetPendingFixes(request, env);
      if (p.startsWith('/api/pending-fixes/') && m === 'DELETE') return apiDeletePendingFix(request, env, p);
      if (p.startsWith('/api/fix-status/')    && m === 'GET')    return apiFixStatus(request, env, p);

      return err('Not found: ' + m + ' ' + p, 404);
    } catch (e) {
      console.error(e);
      return err(String(e.message || e), 500, { stack: e.stack });
    }
  },
};
