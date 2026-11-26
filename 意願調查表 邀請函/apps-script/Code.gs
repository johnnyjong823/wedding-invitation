/**
 * 婚禮回函 → Google Sheet（家宴、朋友宴共用同一支）
 *
 * 使用方式：在 Google Sheet 裡「擴充功能 → Apps Script」，把整份貼上，
 * 先執行一次 setup()，再「部署 → 新增部署作業 → 網頁應用程式」。
 * 已經部署過的話：貼上後重跑 setup()，再「管理部署作業 → 編輯 → 新版本」。
 * 詳細步驟見 ../SETUP.md
 */

const SHEET_STATS = '統計';
// 前 7 欄兩邊一樣，統計公式才能共用
const EVENTS = {
  '家宴': {
    sheet: '家宴回覆',
    sides: ['男方', '女方'],
    headers: ['時間', '姓名', '親友', '出席', '人數', '素食', '兒童椅', '祝福'],
    extra: (d) => [],
  },
  '朋友宴': {
    sheet: '朋友宴回覆',
    sides: ['男方', '女方', '兩邊都熟'],
    headers: ['時間', '姓名', '親友', '出席', '人數', '素食', '兒童椅', '想說的話',
      'Q1 願意來嗎', 'Q2 新郎配得上嗎', 'Q3 當天計畫'],
    extra: (d) => [clean(d.q1, 60), clean(d.q2, 60), clean(d.q3, 60)],
  },
};
const OLD_FRIEND_SHEET = '回覆';   // 只有朋友宴時的舊工作表名稱，setup() 會自動改名

/** 建立兩個回覆工作表與「統計」（重跑也不會壞，既有回覆會保留） */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const old = ss.getSheetByName(OLD_FRIEND_SHEET);
  if (old && !ss.getSheetByName(EVENTS['朋友宴'].sheet)) old.setName(EVENTS['朋友宴'].sheet);

  Object.keys(EVENTS).forEach((ev) => {
    const cfg = EVENTS[ev];
    const sh = ss.getSheetByName(cfg.sheet) || ss.insertSheet(cfg.sheet);
    sh.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers])
      .setFontWeight('bold').setBackground(ev === '家宴' ? '#f2d3cc' : '#ffc8d8');
    sh.setFrozenRows(1);
    sh.setColumnWidth(8, 260);
  });

  const st = ss.getSheetByName(SHEET_STATS) || ss.insertSheet(SHEET_STATS);
  st.clear();
  const f = (ev) => `'${EVENTS[ev].sheet}'!`;
  const col = (fn) => ['家宴', '朋友宴'].map((ev) => fn(f(ev)));
  const rows = [
    ['項目', '家宴 3/14', '朋友宴 3/21'],
    ['回覆筆數', ...col((r) => `=COUNTA(${r}B2:B)`)],
    ['出席（組）', ...col((r) => `=COUNTIF(${r}D2:D,"出席")`)],
    ['無法出席（組）', ...col((r) => `=COUNTIF(${r}D2:D,"無法出席")`)],
    ['出席總人數', ...col((r) => `=SUM(${r}E2:E)`)],
    ['　男方人數', ...col((r) => `=SUMIF(${r}C2:C,"男方",${r}E2:E)`)],
    ['　女方人數', ...col((r) => `=SUMIF(${r}C2:C,"女方",${r}E2:E)`)],
    ['　兩邊都熟人數', ...col((r) => `=SUMIF(${r}C2:C,"兩邊都熟",${r}E2:E)`)],
    ['素食人數', ...col((r) => `=SUM(${r}F2:F)`)],
    ['兒童椅', ...col((r) => `=SUM(${r}G2:G)`)],
    ['預估桌數（10 人一桌）', ...col((r) => `=ROUNDUP(SUM(${r}E2:E)/10)`)],
  ];
  st.getRange(1, 1, rows.length, 3).setValues(rows);
  st.getRange('A1:C1').setFontWeight('bold').setBackground('#ffc8d8');
  st.setColumnWidth(1, 180);
  st.setColumnWidths(2, 2, 120);

  // 移除新試算表預設的空白「工作表1」
  const keep = [SHEET_STATS].concat(Object.keys(EVENTS).map((ev) => EVENTS[ev].sheet));
  ss.getSheets()
    .filter((s) => keep.indexOf(s.getName()) < 0 && s.getLastRow() === 0)
    .forEach((s) => ss.deleteSheet(s));
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const d = JSON.parse(e.postData.contents);
    const name = clean(d.name, 40);
    if (!name) return json({ ok: false, error: 'name required' });

    // 沒帶 event 的是舊版朋友宴頁面
    const ev = EVENTS[d.event] ? d.event : '朋友宴';
    const cfg = EVENTS[ev];
    const attend = d.attend === '無法出席' ? '無法出席' : '出席';
    const side = cfg.sides.indexOf(d.side) >= 0 ? d.side : '';
    const n = (v) => Math.max(0, Math.min(10, parseInt(v, 10) || 0));

    const row = [
      new Date(), name, side, attend,
      attend === '出席' ? Math.max(1, n(d.count)) : 0,
      attend === '出席' ? n(d.veg) : 0,
      attend === '出席' ? n(d.kids) : 0,
      clean(d.message, 500),
    ].concat(cfg.extra(d));

    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.sheet);
    if (!sh) return json({ ok: false, error: 'run setup() first' });

    // 同一個名字再送一次 → 覆蓋舊的那列（修改回覆、重填都不會重複算人數）
    const last = sh.getLastRow();
    let at = -1;
    if (last >= 2) {
      const names = sh.getRange(2, 2, last - 1, 1).getValues();
      for (let i = names.length - 1; i >= 0; i--) {
        if (String(names[i][0]).trim() === name) { at = i + 2; break; }
      }
    }
    if (at > 0) sh.getRange(at, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    return json({ ok: true, updated: at > 0 });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** 用瀏覽器打開部署網址可確認服務是否正常 */
function doGet() {
  return json({ ok: true, msg: 'RSVP endpoint is running', events: Object.keys(EVENTS) });
}

/** 截斷長度，並避免以 = + - @ 開頭的文字被試算表當成公式執行 */
function clean(v, max) {
  let s = String(v == null ? '' : v).trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
