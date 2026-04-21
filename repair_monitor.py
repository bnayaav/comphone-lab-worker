"""
repair_monitor.py - ניטור רציף של דוח תיקוני מעבדה
=====================================================
רץ במקביל ל-neworder_v4.py ו-inventory_arrival_sync.py.
בודק כל 60 שניות את דוח התיקונים של 7 ימים אחרונים.
מזהה שינויי סטטוס ושולח ל-ComPhone Lab Worker.
ה-Worker מזהה שינויים ושולח וואטסאפ אוטומטי ללקוחות שתיקונם מוכן.
"""
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import time
import os
import sys
import pytz

# Force unbuffered output so prints show in Railway logs immediately
sys.stdout.reconfigure(line_buffering=True)

# ===== הגדרות =====
LOGIN_URL   = "https://cellular.neworder.co.il/heb/direct.aspx?UserName=nChDORjeuASklAO4HRJVcQ==&StoreName=eL/mCT/S9JtKfrclQgpe2Q==&password=y5leGHLlRcO1YFjej3CeHQ=="
REPORT_URL  = "https://cellular.neworder.co.il/heb/reports/reportgenerator.aspx"
WORKER_URL  = os.environ.get("LAB_WORKER_URL", "https://comphone-lab-worker.bnaya-av.workers.dev")
SYNC_KEY    = os.environ.get("LAB_SYNC_KEY", "sk_sync_7x9k2m4p8q1n5v3b6c9e2r4t7y1u3i5o")

INTERVAL    = 60   # בדיקה כל 60 שניות
DAYS_BACK   = 7    # טווח סריקה

# Navigation target ל"קריאות שירות מפורט" - זה הדוח של תיקוני המעבדה
REPAIRS_NAV_TARGET = "ctl00$ctrlNavigationBar$ctl214"

# כותרות עמודות של דוח התיקונים
MAIN_HEADERS = [
    'פתח', 'ל.משנה', 'סוג לקוח', 'תאריך קבלה', 'ימי המתנה', 'מ.הזמנה',
    'עדיפות', 'טכנאי משויך', 'תאריך מסירה', 'טלפון', 'סכום חלקים',
    'שעות שהייה במעבדה', 'התקבל ע"י', 'חיוב בחשבונית', 'חיוב', 'עלות',
    'IMEI', 'טופס', 'ביטוח', 'שם הלקוח', 'דגם מכשיר', 'מה תוקן',
    'מלל פנימי', 'סטטוס', 'תקלה', 'קוד סניף', 'פעולות'
]

# ===== שעות פעילות =====
def is_working_hours():
    tz = pytz.timezone("Asia/Jerusalem")
    now = datetime.now(tz)
    wd = now.weekday()
    h = now.hour

    if wd == 5:  # שבת
        return False, "שבת"
    if wd == 4:  # שישי
        if 9 <= h < 13: return True, f"שישי {now.strftime('%H:%M')}"
        return False, "שישי מחוץ לשעות"
    # ראשון-חמישי
    if 9 <= h < 20: return True, now.strftime("%H:%M")
    return False, "מחוץ לשעות"

# ===== עזרים =====
def get_fields(soup):
    f = {}
    for inp in soup.find_all("input", type="hidden"):
        n, v = inp.get("name", ""), inp.get("value", "")
        if n: f[n] = v
    return f

def get_session():
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
    s.get(LOGIN_URL, allow_redirects=True, timeout=15)
    return s

def find_repairs_nav_target(soup):
    """מוצא את הקישור בתפריט לדוח תיקוני מעבדה"""
    # חפש <a> עם טקסט של דוח תיקונים
    for a in soup.find_all('a'):
        text = a.get_text(strip=True)
        if any(kw in text for kw in ['תיקוני מעבדה', 'דוח תיקונים', 'דו"ח תיקונים', 'תיקונים']):
            href = a.get('href', '')
            import re
            m = re.search(r"__doPostBack\(['\"]([^'\"]+)['\"]", href)
            if m:
                return m.group(1)
    return None

def find_field(soup, keyword):
    for inp in soup.find_all("input"):
        nm = inp.get("name", "")
        if keyword in nm:
            return nm
    return None

def extract_main_row(tr):
    """חולץ שורת תיקון ראשית"""
    cells = tr.find_all('td')
    obj = {}
    for i, cell in enumerate(cells):
        if i < len(MAIN_HEADERS):
            obj[MAIN_HEADERS[i]] = cell.get_text(strip=True)
    return obj

def find_nav_target_by_text(soup, target_texts):
    """מחפש __doPostBack target לפי טקסט הקישור"""
    import re
    for a in soup.find_all('a'):
        text = a.get_text(strip=True)
        if not text:
            continue
        for target_text in target_texts:
            if target_text in text:
                href = a.get('href', '')
                onclick = a.get('onclick', '')
                combined = href + ' ' + onclick
                m = re.search(r"__doPostBack\(['\"]([^'\"]+)['\"]", combined)
                if m:
                    return m.group(1), text
    return None, None

def get_repairs(session):
    """מושך את דוח התיקונים של 7 ימים אחרונים"""
    today = datetime.now().strftime("%d/%m/%Y")
    from_date = (datetime.now() - timedelta(days=DAYS_BACK - 1)).strftime("%d/%m/%Y")

    # 1. טען דף דוחות
    r = session.get(REPORT_URL, timeout=15)
    soup = BeautifulSoup(r.text, "html.parser")
    print(f"    [debug] טעינת דף דוחות: {r.status_code} | {len(r.text):,} תווים | URL: {r.url}")

    # 2. חפש את הקישור של דוח התיקונים לפי טקסט
    target_names = ['מצב קריאות שירות', 'קריאות שירות מפורט', 'תיקוני מעבדה', 'פירוט תיקונים']
    nav_target, found_name = find_nav_target_by_text(soup, target_names)

    if not nav_target:
        # debug: הדפס 30 קישורים ראשונים
        print("    ⚠️ לא נמצא קישור. קישורים זמינים:")
        import re
        count = 0
        for a in soup.find_all('a'):
            text = a.get_text(strip=True)
            href = a.get('href', '')
            onclick = a.get('onclick', '')
            combined = href + ' ' + onclick
            m = re.search(r"__doPostBack\(['\"]([^'\"]+)['\"]", combined)
            if m and text and count < 30:
                print(f"      '{text}' → {m.group(1)}")
                count += 1
        if count == 0:
            # אולי אין בכלל __doPostBack בדף - תדפיס את ה-title
            title = soup.find('title')
            h1 = soup.find('h1')
            print(f"    [debug] title: {title.get_text(strip=True) if title else 'אין'}")
            print(f"    [debug] h1: {h1.get_text(strip=True) if h1 else 'אין'}")
            # הדפס את ה-100 תווים הראשונים של ה-body
            body = soup.find('body')
            if body:
                print(f"    [debug] body preview: {body.get_text(strip=True)[:300]}")
        return None, "לא נמצא קישור לדוח תיקונים"

    print(f"    ✓ משתמש בקישור: '{found_name}' → {nav_target}")

    # 3. נווט לדוח
    fields = get_fields(soup)
    fields["__EVENTTARGET"] = nav_target
    fields["__EVENTARGUMENT"] = ""
    r2 = session.post(REPORT_URL, data=fields, timeout=15)
    soup2 = BeautifulSoup(r2.text, "html.parser")
    print(f"    [debug] אחרי ניווט: {r2.status_code} | {len(r2.text):,} תווים")

    # 4. מצא שדות תאריך + כפתור הצגה
    from_field = find_field(soup2, "txtFromDate")
    to_field = find_field(soup2, "txtToDate")
    btn_field = find_field(soup2, "btnConfirm") or find_field(soup2, "btnShowReport")

    if not from_field or not to_field:
        # debug: מה יש בדף?
        title2 = soup2.find('title')
        h1_2 = soup2.find('h1')
        print(f"    [debug] אחרי ניווט - title: {title2.get_text(strip=True) if title2 else 'אין'}")
        print(f"    [debug] אחרי ניווט - h1: {h1_2.get_text(strip=True) if h1_2 else 'אין'}")
        inputs_sample = [inp.get('name', '') for inp in soup2.find_all('input')[:20]]
        print(f"    [debug] inputs: {inputs_sample}")
        return None, f"שדות תאריך לא נמצאו אחרי ניווט ל-{found_name}"

    # 4. שלח טופס
    fields = get_fields(soup2)
    fields["__EVENTTARGET"] = ""
    fields["__EVENTARGUMENT"] = ""
    fields[from_field] = from_date
    fields[to_field] = today
    if btn_field:
        fields[btn_field] = "הצג דו''ח"

    r3 = session.post(REPORT_URL, data=fields, timeout=60)
    soup3 = BeautifulSoup(r3.text, "html.parser")

    # 5. חלץ את הטבלה הראשית
    main_table = soup3.find('table', id='MainContent_gvReportData')
    if not main_table:
        # fallback - חפש לפי כותרות
        for t in soup3.find_all('table'):
            ths = [th.get_text(strip=True) for th in t.find_all('th')]
            if 'שם הלקוח' in ths and ('דגם מכשיר' in ths or 'טופס' in ths):
                main_table = t
                break

    if not main_table:
        return None, "טבלת תיקונים לא נמצאה"

    # 6. חלץ שורות תיקון
    repairs = []
    tbody = main_table.find('tbody') or main_table
    for tr in tbody.find_all('tr', recursive=False):
        if tr.find('th'):
            continue
        cells = tr.find_all('td')
        if len(cells) < 20:
            continue
        data = extract_main_row(tr)
        if data.get('טופס'):
            repairs.append(data)

    return repairs, None

def send_to_worker(repairs):
    """שולח את התיקונים ל-Worker"""
    try:
        r = requests.post(
            f"{WORKER_URL}/api/sync",
            headers={"Content-Type": "application/json", "X-Sync-Key": SYNC_KEY},
            json={"repairs": repairs},
            timeout=30
        )
        if r.status_code == 200:
            return r.json(), None
        return None, f"HTTP {r.status_code}: {r.text[:200]}"
    except Exception as e:
        return None, str(e)

def main():
    print("🔧 ניטור תיקוני מעבדה")
    print(f"   בדיקה כל {INTERVAL} שניות")
    print(f"   Worker: {WORKER_URL}")
    print("-" * 50)

    if not SYNC_KEY:
        print("❌ LAB_SYNC_KEY לא מוגדר")
        return

    session = None
    consecutive_errors = 0

    while True:
        active, reason = is_working_hours()
        if not active:
            print(f"[{datetime.now().strftime('%H:%M')}] 💤 {reason}", end="\r")
            time.sleep(60)
            continue

        try:
            # ריענון session אם צריך
            if session is None or consecutive_errors >= 3:
                print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🔑 מתחבר...")
                session = get_session()
                consecutive_errors = 0

            # משוך דוח
            repairs, err = get_repairs(session)

            if err:
                print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ⚠️  {err}")
                consecutive_errors += 1
                session = None
                time.sleep(INTERVAL)
                continue

            if not repairs:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] אין תיקונים", end="\r")
                consecutive_errors = 0
                time.sleep(INTERVAL)
                continue

            # שלח ל-Worker
            result, err = send_to_worker(repairs)

            if err:
                print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ❌ Worker: {err}")
                consecutive_errors += 1
            else:
                stats = result.get('stats', {})
                details = result.get('details', {})
                added = stats.get('added', 0)
                changed = stats.get('statusChanged', 0)
                triggered = stats.get('triggered', 0)
                auto_sent = stats.get('autoSent', 0)

                if added > 0 or changed > 0 or triggered > 0:
                    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🔔 עדכון!")
                    print(f"   סה\"כ: {len(repairs)} · חדשים: {added} · שינויי סטטוס: {changed}")

                    # הצג שינויי סטטוס
                    for sc in details.get('statusChanged', [])[:5]:
                        print(f"   [{sc.get('form')}] {sc.get('name','?')[:20]:20s} | {sc.get('from','?')} → {sc.get('to','?')}")

                    # הצג הודעות וואטסאפ שנשלחו
                    if triggered > 0:
                        print(f"   🔔 טריגר וואטסאפ: {triggered}")
                        if auto_sent > 0:
                            print(f"   ✅ נשלחו אוטומטית: {auto_sent}")
                            for sent in details.get('autoSent', [])[:3]:
                                print(f"      ✓ {sent.get('name')} ({sent.get('phone')})")
                        pending = details.get('pendingManual', [])
                        if pending:
                            print(f"   💬 ממתינים לשליחה ידנית: {len(pending)}")
                            for p in pending[:3]:
                                print(f"      📱 {p.get('name')} ({p.get('phone')})")

                    if result.get('seededNow'):
                        print(f"   ℹ️  זה סנכרון ראשוני - לא נשלחו הודעות")
                else:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {len(repairs)} תיקונים · ללא שינוי", end="\r")

                consecutive_errors = 0

        except Exception as e:
            print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ❌ {e}")
            consecutive_errors += 1
            session = None

        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
