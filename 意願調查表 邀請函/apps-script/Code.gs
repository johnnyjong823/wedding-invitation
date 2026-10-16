/**
 * 婚禮意願調查表 → Google Sheet
 *
 * 使用方式：在 Google Sheet 裡「擴充功能 → Apps Script」，把整份貼上，
 * 先執行一次 setup()，再「部署 → 新增部署作業 → 網頁應用程式」。
 * 詳細步驟見 ../SETUP.md
 */

const SHEET_REPLIES = '回覆';
const SHEET_STATS = '統計';
const HEADERS = [
  '時間', '姓名', '親友', '出席', '人數', '素食', '兒童椅', '想說的話',
  'Q1 願意來嗎', 'Q2 新郎配得上嗎', 'Q3 當天計畫',
];

/** 建立「回覆」與「統計」工作表（只需執行一次，重跑也不會壞） */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sh = ss.getSheetByName(SHEET_REPLIES) || ss.insertSheet(SHEET_REPLIES);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#ffc8d8');
  sh.setFrozenRows(1);
  sh.setColumnWidth(8, 260);

  let st = ss.getSheetByName(SHEET_STATS) || ss.insertSheet(SHEET_STATS);
  const r = `'${SHEET_REPLIES}'!`;
  st.getRange('A1:B10').setValues([
    ['項目', '數量'],
    ['回覆筆數', `=COUNTA(${r}B2:B)`],
    ['出席（組）', `=COUNTIF(${r}D2:D,"出席")`],
    ['無法出席（組）', `=COUNTIF(${r}D2:D,"無法出席")`],
    ['出席總人數', `=SUM(${r}E2:E)`],
    ['　男方人數', `=SUMIF(${r}C2:C,"男方",${r}E2:E)`],
    ['　女方人數', `=SUMIF(${r}C2:C,"女方",${r}E2:E)`],
    ['　兩邊都熟人數', `=SUMIF(${r}C2:C,"兩邊都熟",${r}E2:E)`],
    ['素食人數', `=SUM(${r}F2:F)`],
    ['兒童椅', `=SUM(${r}G2:G)`],
  ]);
  st.getRange('A1:B1').setFontWeight('bold').setBackground('#ffc8d8');
  st.setColumnWidth(1, 160);

  // 移除新試算表預設的空白「工作表1」
  const blank = ss.getSheets().find(s => s.getName() !== SHEET_REPLIES && s.getName() !== SHEET_STATS
    && s.getLastRow() === 0);
  if (blank) ss.deleteSheet(blank);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const d = JSON.parse(e.postData.contents);
    const name = clean(d.name, 40);
    if (!name) return json({ ok: false, error: 'name required' });

    const attend = d.attend === '無法出席' ? '無法出席' : '出席';
    const side = ['男方', '女方', '兩邊都熟'].includes(d.side) ? d.side : '';
    const n = (v) => Math.max(0, Math.min(10, parseInt(v, 10) || 0));

    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_REPLIES);
    sh.appendRow([
      new Date(), name, side, attend,
      attend === '出席' ? Math.max(1, n(d.count)) : 0,
      attend === '出席' ? n(d.veg) : 0,
      attend === '出席' ? n(d.kids) : 0,
      clean(d.message, 500),
      clean(d.q1, 60), clean(d.q2, 60), clean(d.q3, 60),
    ]);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** 用瀏覽器打開部署網址可確認服務是否正常 */
function doGet() {
  return json({ ok: true, msg: 'RSVP endpoint is running' });
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
