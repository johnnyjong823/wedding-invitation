/**
 * 婚禮籌備清單：多人同步（Google Sheet 當資料庫）
 *
 * 使用方式：在 Google Sheet 裡「擴充功能 → Apps Script」，把整份貼上，
 * 先執行一次 setup()，再「部署 → 新增部署作業 → 網頁應用程式」。
 * 詳細步驟見 ../SETUP.md
 *
 * 資料格式：每個勾選／負責人／備註是一列「欄位」，例如 done.venue、sub.venue_0、owner.venue、note.venue。
 * 每次寫入整批共用一個「版本」號；網頁帶 since=上次版本 來拿之後的變更。
 */

const SHEET = '進度';
const HEADERS = ['欄位', '值', '版本', '更新時間'];
const KEY_RE = /^(done|sub|owner|note)\.[\w-]{1,40}$/;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('💍 籌備清單同步')
    .addItem('① 初始化（setup）', 'setup')
    .addItem('🔑 顯示同步密碼', 'showKey')
    .addItem('🔄 更換同步密碼', 'resetKey')
    .addToUi();
}

/** 建立「進度」工作表與同步密碼（重跑也不會壞） */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#f6e4e7');
  sh.setFrozenRows(1);
  sh.getRange('B:B').setNumberFormat('@'); // 值存 JSON 文字，避免 true/false 被轉成布林
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 320);

  const blank = ss.getSheets().find(s => s.getName() !== SHEET && s.getLastRow() === 0);
  if (blank) ss.deleteSheet(blank);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SYNC_KEY')) props.setProperty('SYNC_KEY', newKey_());
  if (!props.getProperty('REV')) props.setProperty('REV', '0');
  // 不用 alert：從編輯器執行時，alert 會開在試算表分頁上等人按「確定」，編輯器就一直轉圈
  const key = props.getProperty('SYNC_KEY');
  Logger.log('同步密碼：' + key);
  ss.toast('同步密碼：' + key, '✅ 初始化完成', 30);
}

function showKey() {
  const key = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  const msg = key ? `同步密碼：${key}\n\n第一次打開規劃表時輸入這組密碼，或把「複製同步連結」的網址傳給另一半。`
    : '請先執行「① 初始化」';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

/** 換密碼後，舊密碼的瀏覽器會停止同步，需要重新輸入 */
function resetKey() {
  PropertiesService.getScriptProperties().setProperty('SYNC_KEY', newKey_());
  showKey();
}

/** ?key=…&since=版本 → 回傳之後的變更；不帶 key 可用來確認服務是否正常 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.key) return json({ ok: true, msg: 'checklist sync endpoint is running' });
  if (!keyOk_(p.key)) return json({ ok: false, error: 'bad key' });

  const rev = getRev_();
  let since = parseInt(p.since, 10) || 0;
  if (since > rev) since = 0; // 工作表被清掉重來時，讓網頁整份重抓
  if (since === rev) return json({ ok: true, rev, changes: [] });

  const changes = readRows_()
    .filter(r => Number(r[2]) > since)
    .map(r => ({ k: String(r[0]), v: parse_(r[1]) }));
  return json({ ok: true, rev, changes });
}

/** body：{ key, changes: { 'done.venue': true, 'note.venue': '…', … } }，值為 null 代表清除 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const d = JSON.parse(e.postData.contents);
    if (!keyOk_(d.key)) return json({ ok: false, error: 'bad key' });

    const changes = d.changes || {};
    const keys = Object.keys(changes).filter(k => KEY_RE.test(k)).slice(0, 1000);
    if (!keys.length) return json({ ok: true, rev: getRev_() });

    const rev = getRev_() + 1;
    const now = new Date();
    const rows = readRows_();
    const idx = {};
    rows.forEach((r, i) => { idx[r[0]] = i; });
    keys.forEach(k => {
      const row = [k, toCell_(changes[k]), rev, now];
      if (k in idx) rows[idx[k]] = row;
      else { idx[k] = rows.length; rows.push(row); }
    });

    const sh = sheet_();
    sh.getRange(2, 2, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
    PropertiesService.getScriptProperties().setProperty('REV', String(rev));
    return json({ ok: true, rev });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET);
}

function readRows_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  return last > 1 ? sh.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];
}

function getRev_() {
  return parseInt(PropertiesService.getScriptProperties().getProperty('REV'), 10) || 0;
}

function keyOk_(key) {
  const k = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  return !!k && key === k;
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

/** 存成 JSON 文字（字串開頭一定是 " 或 true/false/null，不會被當成公式） */
function toCell_(v) {
  if (typeof v === 'string') v = v.slice(0, 5000);
  else if (typeof v !== 'boolean') v = v == null ? null : String(v).slice(0, 200);
  return JSON.stringify(v);
}

function parse_(c) {
  if (typeof c === 'boolean') return c;
  try { return JSON.parse(String(c)); } catch (e) { return String(c); }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
