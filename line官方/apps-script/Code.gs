/**
 * 婚禮 LINE 官方帳號小幫手（LINE Messaging API × Google Apps Script）
 *
 * 功能：加好友歡迎訊息、婚禮資訊卡、查座位、交通停車、回覆出席連結、
 *       收祝福留言、收照片存到雲端硬碟、推播通知（可排程）、訊息紀錄。
 *
 * 使用方式：在 Google Sheet 裡「擴充功能 → Apps Script」，把整份貼上，
 * 先執行一次 setup()，再「部署 → 新增部署作業 → 網頁應用程式」。
 * 詳細步驟見 ../SETUP.md
 */

const TZ = 'Asia/Taipei';
const SHEETS = {
  settings: '設定',
  seats: '座位表',
  broadcast: '推播',
  friends: '好友',
  blessings: '祝福',
  photos: '照片',
  log: '訊息紀錄',
};
const RSVP_SHEET = '回覆'; // 邀請函那份試算表的工作表名稱（見 ../意願調查表 邀請函/apps-script/Code.gs）

/** [項目, 預設值, 說明]；setup() 只補上缺少的項目，不會覆蓋你填好的內容 */
const DEFAULT_SETTINGS = [
  ['新郎', '新郎', ''],
  ['新娘', '新娘', ''],
  ['日期', '2027 年 ○ 月 ○ 日（星期○）', ''],
  ['時間', '中午 12:00 入席・12:30 開席', ''],
  ['地點', '○○ 飯店 ○ 樓 ○○ 廳', ''],
  ['地址', '○○市○○區○○路 ○ 號', ''],
  ['婚禮開始時間', '', '填真正的日期時間，例如 2027/5/1 12:00；婚禮資訊卡會顯示倒數天數，也用來建立倒數推播'],
  ['出席回覆試算表', '', '貼上邀請函那份「婚禮出席統計」試算表的網址；填了親友才能查「出席狀態」'],
  ['地圖連結', '', '留空會自動用「地點＋地址」搜尋 Google 地圖'],
  ['交通資訊', '🚇 捷運：○○站 ○ 號出口步行 5 分鐘\n🚌 公車：○○ 站下車', '可換行（儲存格內按 Alt+Enter）'],
  ['停車資訊', '🅿️ 飯店地下停車場，憑喜帖可折抵 3 小時', ''],
  ['邀請函網址', 'https://johnnyjong823.github.io/wedding-invitation/', '「回覆出席」按鈕會開這個網址；留空就不顯示'],
  ['座位查詢開放', '否', '「是」= 立即開放；座位排好前請維持「否」'],
  ['座位開放時間', '', '選填，例如 2027/5/1 08:00，時間到自動開放（不必等你手動改「是」）'],
  ['座位未開放訊息', '座位還在努力安排中 🪑\n婚禮當天早上就會開放查詢，到時候再來問我喔！', ''],
  ['座位圖網址', '', '選填，https 開頭的 .jpg/.png 圖片網址（不能用 Google 雲端硬碟連結）；查到座位時會一起附上'],
  ['照片資料夾ID', '', 'setup() 會自動建立「婚禮照片（LINE）」資料夾並填入；清空 = 關閉收照片功能'],
  ['歡迎詞', '嗨 {name}！歡迎加入 {新郎} & {新娘} 的婚禮小幫手 💍\n\n婚禮前我們會在這裡通知重要消息，婚禮當天也可以在這裡查座位喔！\n\n點下方選單或按下面的按鈕開始 👇', '{name} 會換成對方的 LINE 名稱；{新郎}{新娘} 也會自動代入'],
  ['看不懂的訊息回覆選單', '是', '「否」= 不認得的訊息就不回（適合你們要親自用聊天回覆時）'],
  ['管理員userId', '', '推播「測試發給自己」用；加好友後到「好友」工作表複製你自己那列的 userId 貼過來'],
];

const SEAT_HEADERS = ['姓名', '別名（逗號分隔，選填）', '桌號', '桌名／區域', '備註'];
const BROADCAST_HEADERS = ['內容', '圖片網址（選填）', '預定時間（留空＝手動發送）', '狀態', '實際發送時間', '結果'];
const FRIEND_HEADERS = ['userId', 'LINE 名稱', '加入時間', '狀態', '最後互動'];
const BLESSING_HEADERS = ['時間', 'LINE 名稱', '祝福內容', 'userId', '照片牆顯示（填「否」隱藏）'];
const PHOTO_HEADERS = ['時間', 'LINE 名稱', '類型', '檔案ID', '照片牆顯示（填「否」隱藏）', 'userId'];
const LOG_HEADERS = ['時間', 'LINE 名稱', '類型', '內容', 'userId'];

const QUICK_ITEMS = ['婚禮資訊', '查座位', '交通停車', '回覆出席', '出席狀態', '送上祝福', '上傳照片'];

/** 倒數推播範本：[婚禮前幾天, 幾點發, 內容]。{xx} 會換成「設定」裡的值 */
const COUNTDOWN_TEMPLATES = [
  [7, 20, '⏳ 婚禮倒數 7 天！\n\n{新郎} & {新娘} 的婚禮就在\n📅 {日期}\n⏰ {時間}\n📍 {地點}\n\n還沒回覆出席的朋友，點下方選單「回覆出席」喔！\n已經填過的，可以點「出席狀態」確認 💕'],
  [1, 20, '🎉 明天就是婚禮了！\n\n⏰ {時間}\n📍 {地點}\n🗺️ {地址}\n\n怎麼去、停哪裡 → 點選單「交通停車」\n明天到場後 → 點「查座位」就知道坐哪桌 🪑\n\n明天見 💍'],
];

/* =========================================================
 * 試算表選單與初始化
 * ========================================================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('💍 LINE 小幫手')
    .addItem('① 初始化工作表（setup）', 'setup')
    .addItem('② 設定 Channel Access Token', 'setToken')
    .addItem('③ 顯示 Webhook 網址', 'showWebhookUrl')
    .addItem('🖼 顯示照片牆網址', 'showWallUrl')
    .addSeparator()
    .addItem('⏳ 建立婚禮倒數推播（7 天、1 天前）', 'createCountdownBroadcasts')
    .addItem('📤 推播：發送目前選取的那一列', 'sendSelectedBroadcast')
    .addItem('🧪 推播：選取列先只發給自己測試', 'testSelectedBroadcast')
    .addItem('⏰ 開啟排程推播（每 5 分鐘檢查）', 'enableScheduler')
    .addItem('⏹ 關閉排程推播', 'disableScheduler')
    .addSeparator()
    .addItem('📊 查詢本月訊息額度', 'showQuota')
    .addToUi();
}

/** 建立所有工作表（只需執行一次，重跑也不會壞、不會覆蓋資料） */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 設定：只補缺少的項目
  const st = ensureSheet_(ss, SHEETS.settings, ['項目', '內容', '說明']);
  const have = new Set(st.getRange(1, 1, Math.max(st.getLastRow(), 1), 1).getValues().map(r => r[0]));
  const missing = DEFAULT_SETTINGS.filter(r => !have.has(r[0]));
  if (missing.length) st.getRange(st.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  st.setColumnWidth(1, 150).setColumnWidth(2, 380).setColumnWidth(3, 420);
  st.getRange('B:C').setWrap(true).setVerticalAlignment('top');
  const yesNo = SpreadsheetApp.newDataValidation().requireValueInList(['是', '否'], true).build();
  ['座位查詢開放', '看不懂的訊息回覆選單'].forEach(k => {
    const row = findSettingRow_(st, k);
    if (row) st.getRange(row, 2).setDataValidation(yesNo);
  });

  const seats = ensureSheet_(ss, SHEETS.seats, SEAT_HEADERS);
  if (seats.getLastRow() === 1) {
    seats.appendRow(['王小明', '小明, Ming', 5, '男方同學桌', '← 範例，請刪掉這列再貼上你們的座位表']);
  }
  seats.setColumnWidth(2, 180).setColumnWidth(4, 160).setColumnWidth(5, 280);

  const bc = ensureSheet_(ss, SHEETS.broadcast, BROADCAST_HEADERS);
  bc.setColumnWidth(1, 380).setColumnWidth(2, 200).setColumnWidth(3, 190).setColumnWidth(6, 260);
  bc.getRange('A:A').setWrap(true);
  bc.getRange('C2:C').setNumberFormat('yyyy/mm/dd hh:mm');

  ensureSheet_(ss, SHEETS.friends, FRIEND_HEADERS).setColumnWidth(1, 300);
  ensureSheet_(ss, SHEETS.blessings, BLESSING_HEADERS).setColumnWidth(3, 420);
  ensureSheet_(ss, SHEETS.photos, PHOTO_HEADERS).setColumnWidth(4, 300);
  ensureSheet_(ss, SHEETS.log, LOG_HEADERS).setColumnWidth(4, 360);
  const dateRow = findSettingRow_(st, '婚禮開始時間');
  if (dateRow) st.getRange(dateRow, 2).setNumberFormat('yyyy/mm/dd hh:mm');

  // 移除新試算表預設的空白工作表
  const ours = new Set(Object.values(SHEETS));
  ss.getSheets().filter(s => !ours.has(s.getName()) && s.getLastRow() === 0)
    .forEach(s => ss.deleteSheet(s));

  // Webhook 驗證碼（Apps Script 讀不到 LINE 的簽章標頭，改用網址上的密碼擋掉外人亂打）
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('WEBHOOK_KEY')) {
    props.setProperty('WEBHOOK_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  }
  if (!props.getProperty('WALL_KEY')) {
    props.setProperty('WALL_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 12));
  }

  // 照片資料夾
  const folderRow = findSettingRow_(st, '照片資料夾ID');
  if (folderRow && !st.getRange(folderRow, 2).getValue() && !props.getProperty('PHOTO_FOLDER_CREATED')) {
    const folder = DriveApp.createFolder('婚禮照片（LINE）');
    st.getRange(folderRow, 2).setValue(folder.getId());
    props.setProperty('PHOTO_FOLDER_CREATED', '1');
  }

  toast_('初始化完成！下一步：選單「② 設定 Channel Access Token」');
}

function setToken() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('設定 Channel Access Token',
    '到 LINE Developers → 你的 Channel → Messaging API 分頁最下方，\n' +
    '「Channel access token (long-lived)」按 Issue 後複製貼上：', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const token = r.getResponseText().trim();
  if (!token) return;
  PropertiesService.getScriptProperties().setProperty('LINE_TOKEN', token);
  try {
    const bot = lineApi_('https://api.line.me/v2/bot/info');
    ui.alert(`✅ 已連線到官方帳號：${bot.displayName}（${bot.basicId}）`);
  } catch (err) {
    ui.alert('⚠️ Token 已儲存，但測試連線失敗，請確認有沒有複製完整：\n\n' + err.message);
  }
}

function showWebhookUrl() {
  showUrlDialog_('Webhook 網址', 'WEBHOOK_KEY', '?key=',
    '把下面整串貼到 LINE Developers → Messaging API → Webhook URL：');
}

function showWallUrl() {
  showUrlDialog_('照片牆網址', 'WALL_KEY', '?page=wall&key=',
    '婚禮當天用電腦打開這個網址、按 F11 全螢幕，接上投影機或電視就行。\n' +
    '（照片牆會每 15 秒自動抓新照片；不想上牆的照片／祝福，在「照片」「祝福」工作表那列填「否」）');
}

function showUrlDialog_(title, propKey, suffix, intro) {
  const key = PropertiesService.getScriptProperties().getProperty(propKey);
  if (!key) return SpreadsheetApp.getUi().alert('請先執行「① 初始化工作表」');
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* 尚未部署 */ }
  url = url.replace(/\/dev$/, '/exec');
  const full = url + suffix + key;
  const msg = url ? intro : `還沒部署成網頁應用程式。部署後的網址是：\n\n（網頁應用程式網址）${suffix}${key}`;
  const html = HtmlService.createHtmlOutput(
    `<p style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml_(msg)}</p>` +
    (url ? `<textarea style="width:100%;height:80px" onclick="this.select()">${escapeHtml_(full)}</textarea>` : '')
  ).setWidth(520).setHeight(280);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

/* =========================================================
 * LINE Webhook
 * ========================================================= */

function doPost(e) {
  const key = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY');
  if (!e || !e.postData || !key || e.parameter.key !== key) return text_('ignored');

  const body = JSON.parse(e.postData.contents || '{}');
  (body.events || []).forEach(ev => {
    try {
      handleEvent_(ev);
    } catch (err) {
      logRow_(ev.source && ev.source.userId, '錯誤', String(err && err.stack || err));
    }
  });
  return text_('ok');
}

/** 用瀏覽器打開部署網址可確認服務是否正常；?page=wall&key=… 是照片牆 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.page === 'wall' && wallKeyOk_(p.key)) {
    const t = HtmlService.createTemplateFromFile('Wall');
    t.key = p.key;
    return t.evaluate().setTitle('婚禮照片牆')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return text_('LINE wedding bot is running');
}

function handleEvent_(ev) {
  if (!ev.source || ev.source.type !== 'user') return; // 只處理一對一聊天
  const userId = ev.source.userId;

  switch (ev.type) {
    case 'follow': {
      const name = upsertFriend_(userId, '好友', true);
      const s = settings_();
      const welcome = fillVars_(s['歡迎詞'], { name });
      return reply_(ev.replyToken, [{ type: 'text', text: welcome }]);
    }
    case 'unfollow':
      upsertFriend_(userId, '已封鎖');
      return;
    case 'message':
      upsertFriend_(userId, '好友');
      if (ev.message.type === 'text') return handleText_(ev);
      if (ev.message.type === 'image' || ev.message.type === 'video') return handleMedia_(ev);
      return;
  }
}

/* ---------- 文字訊息 ---------- */

// prefix: true 代表「關鍵字＋內容」也算（例如「座位 王小明」「祝福 新婚快樂」）
const COMMANDS = [
  { words: ['婚禮資訊', '資訊', '日期', '時間', '地點', '在哪裡', '在哪'], run: replyInfo_ },
  { words: ['查座位', '座位表', '座位', '我坐哪', '桌號'], run: replySeat_, prefix: true },
  { words: ['交通停車', '交通', '停車', '怎麼去'], run: replyTraffic_ },
  { words: ['出席狀態', '報名狀態', '查報名', '我有報名嗎', '查出席'], run: replyStatus_, prefix: true },
  { words: ['回覆出席', '報名', '出席', '邀請函'], run: replyRsvp_ },
  { words: ['送上祝福', '祝福', '留言'], run: replyBlessing_, prefix: true },
  { words: ['上傳照片', '照片', '傳照片'], run: replyPhotoHelp_ },
  { words: ['功能', '選單', '說明', 'help', '?', '？'], run: replyHelp_ },
];

function handleText_(ev) {
  const userId = ev.source.userId;
  const raw = String(ev.message.text || '').trim();
  const t = norm_(raw);
  logRow_(userId, '文字', raw);

  for (const cmd of COMMANDS) {
    for (const w of cmd.words) {
      if (t === norm_(w)) return cmd.run(ev, '');
      if (cmd.prefix && t.startsWith(norm_(w))) {
        const lead = raw.replace(/^\s+/, '');
        const rest = (lead.toLowerCase().startsWith(w) ? lead.slice(w.length) : t.slice(norm_(w).length))
          .replace(/^[\s:：,，]+/, '');
        if (rest) return cmd.run(ev, rest);
      }
    }
  }

  // 正在等使用者輸入名字 / 祝福
  const cache = CacheService.getScriptCache();
  const state = cache.get('state:' + userId);
  if (state) cache.remove('state:' + userId);
  if (state === 'seat') return replySeat_(ev, raw);
  if (state === 'blessing') return replyBlessing_(ev, raw);
  if (state === 'status') return replyStatus_(ev, raw);

  // 婚禮當天：直接打名字也能查
  if (seatOpen_() && findSeats_(raw, true).length) return replySeat_(ev, raw);

  if (settings_()['看不懂的訊息回覆選單'] !== '否') return replyHelp_(ev);
}

function replyInfo_(ev) {
  const s = settings_();
  const mapUrl = s['地圖連結'] ||
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s['地點'] + ' ' + s['地址']);
  const row = (icon, label, value) => ({
    type: 'box', layout: 'baseline', spacing: 'md', contents: [
      { type: 'text', text: icon + ' ' + label, size: 'sm', color: '#b07a8c', flex: 2 },
      { type: 'text', text: value || '-', size: 'sm', color: '#444444', wrap: true, flex: 5 },
    ],
  });
  const buttons = [
    { type: 'button', style: 'primary', color: '#e8829e', height: 'sm',
      action: { type: 'uri', label: '📍 開啟地圖導航', uri: mapUrl } },
  ];
  if (/^https:\/\//.test(s['邀請函網址'])) {
    buttons.push({ type: 'button', style: 'secondary', height: 'sm',
      action: { type: 'uri', label: '💌 回覆出席', uri: s['邀請函網址'] } });
  }
  buttons.push({ type: 'button', style: 'secondary', height: 'sm',
    action: { type: 'message', label: '🪑 查座位', text: '查座位' } });

  const headerContents = [
    { type: 'text', text: 'WEDDING INVITATION', size: 'xs', color: '#c9738d', weight: 'bold' },
    { type: 'text', text: `${s['新郎']} & ${s['新娘']}`, size: 'xl', weight: 'bold', color: '#7a3d52', wrap: true, margin: 'sm' },
    { type: 'text', text: '誠摯邀請你一起見證我們的幸福 💍', size: 'sm', color: '#9b6577', wrap: true, margin: 'sm' },
  ];
  const days = daysUntilWedding_();
  if (days != null && days >= 0) {
    headerContents.push({
      type: 'text', margin: 'md', size: 'md', weight: 'bold', color: '#d4567a',
      text: days === 0 ? '🎉 就是今天！' : days === 1 ? '⏳ 就是明天了！' : `⏳ 倒數 ${days} 天`,
    });
  }

  const bubble = {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#ffe3ea', paddingAll: '18px', contents: headerContents,
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', contents: [
        row('📅', '日期', s['日期']),
        row('⏰', '時間', s['時間']),
        row('🏨', '地點', s['地點']),
        row('🗺️', '地址', s['地址']),
      ],
    },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
  };
  reply_(ev.replyToken, [{ type: 'flex', altText: `💍 ${s['新郎']} & ${s['新娘']} 婚禮資訊`, contents: bubble }]);
}

function replyTraffic_(ev) {
  const s = settings_();
  const parts = [`🏨 ${s['地點']}`, `🗺️ ${s['地址']}`];
  if (s['交通資訊']) parts.push('', s['交通資訊']);
  if (s['停車資訊']) parts.push('', s['停車資訊']);
  reply_(ev.replyToken, [{ type: 'text', text: parts.join('\n') }]);
}

function replyRsvp_(ev) {
  const url = settings_()['邀請函網址'];
  const text = url
    ? `💌 點這裡填寫出席意願（順便玩玩我們的小問卷 😆）：\n${url}\n\n已經填過了？點下面「出席狀態」可以確認我們有沒有收到 ✅`
    : '出席回覆還沒開放，再請你稍等一下喔 🙏';
  reply_(ev.replyToken, [{ type: 'text', text }]);
}

/* ---------- 出席狀態（讀邀請函那份試算表） ---------- */

function replyStatus_(ev, query) {
  const s = settings_();
  const userId = ev.source.userId;
  const ssId = (String(s['出席回覆試算表']).match(/[-\w]{25,}/) || [])[0];
  if (!ssId) {
    return reply_(ev.replyToken, [{ type: 'text', text: '出席狀態查詢還沒開放，有問題直接問新郎新娘喔 🙏' }]);
  }
  if (!query) {
    CacheService.getScriptCache().put('state:' + userId, 'status', 600);
    return reply_(ev.replyToken, [{ type: 'text', text: '✅ 請輸入你填表時寫的姓名：' }], false);
  }

  const sh = SpreadsheetApp.openById(ssId).getSheetByName(RSVP_SHEET);
  const q = norm_(query);
  // 欄位：時間、姓名、親友、出席、人數、素食、兒童椅、想說的話…
  const rows = sh && sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().filter(r => norm_(String(r[1]).replace(/^'/, '')) === q)
    : [];

  if (!rows.length) {
    CacheService.getScriptCache().put('state:' + userId, 'status', 600);
    const url = s['邀請函網址'];
    return reply_(ev.replyToken, [{
      type: 'text',
      text: `查不到「${query}」的回覆 🤔\n可能是填表時用了別的名字，可以再輸入一次試試。` +
        (url ? `\n\n還沒填的話點這裡 👉 ${url}` : ''),
    }], false);
  }

  const [time, name, , attend, count, veg, kids] = rows[rows.length - 1];
  const when = time instanceof Date ? Utilities.formatDate(time, TZ, 'M/d HH:mm') : '';
  let text;
  if (attend === '無法出席') {
    text = `📝 有收到 ${name} 的回覆：這次無法出席。\n謝謝你的祝福，之後一定要約吃飯 💕`;
  } else {
    text = `✅ 有收到 ${name} 的回覆！\n\n🙋 出席・${count} 位` +
      (veg > 0 ? `\n🥬 素食 ${veg} 位` : '') +
      (kids > 0 ? `\n👶 兒童椅 ${kids} 張` : '') +
      '\n\n期待那天見到你 💍';
  }
  if (when) text += `\n（填寫於 ${when}）`;
  if (rows.length > 1) text += `\n\n※ 同名的回覆有 ${rows.length} 筆，這裡顯示最新一筆`;
  text += '\n\n要修改的話，直接私訊新郎或新娘就好 🙏';
  reply_(ev.replyToken, [{ type: 'text', text }]);
}

function replyPhotoHelp_(ev) {
  const on = !!settings_()['照片資料夾ID'];
  const text = on
    ? '📸 直接把照片或影片傳到這個聊天室就可以了！\n\n一次傳很多張也沒問題，我們會全部收進婚禮相簿，謝謝你幫忙記錄這一天 🥰'
    : '📸 照片收集功能還沒開放，敬請期待！';
  reply_(ev.replyToken, [{ type: 'text', text }]);
}

function replyHelp_(ev) {
  reply_(ev.replyToken, [{
    type: 'text',
    text: '我是婚禮小幫手 🤵👰 可以幫你：\n\n' +
      '📅 婚禮資訊：時間、地點、導航\n' +
      '🪑 查座位：輸入你的名字就知道坐哪桌\n' +
      '🚗 交通停車\n' +
      '💌 回覆出席\n' +
      '✅ 出席狀態：確認我們有收到你的回覆\n' +
      '💐 送上祝福：留言給新人\n' +
      '📸 上傳照片：直接傳照片給我\n\n' +
      '點下面的按鈕試試看 👇',
  }]);
}

/* ---------- 查座位 ---------- */

function replySeat_(ev, query) {
  const s = settings_();
  const userId = ev.source.userId;
  if (!seatOpen_()) {
    return reply_(ev.replyToken, [{ type: 'text', text: s['座位未開放訊息'] }]);
  }
  if (!query) {
    CacheService.getScriptCache().put('state:' + userId, 'seat', 600);
    return reply_(ev.replyToken, [{ type: 'text', text: '🪑 請輸入你的姓名（報名時填的名字）：' }], false);
  }

  const found = findSeats_(query, false);
  if (!found.length) {
    CacheService.getScriptCache().put('state:' + userId, 'seat', 600);
    return reply_(ev.replyToken, [{
      type: 'text',
      text: `找不到「${query}」😢\n請再輸入一次完整姓名，或直接詢問現場招待人員喔！`,
    }], false);
  }
  if (found.length > 5) {
    CacheService.getScriptCache().put('state:' + userId, 'seat', 600);
    return reply_(ev.replyToken, [{ type: 'text', text: `符合「${query}」的人有點多 😅 請輸入完整姓名再查一次：` }], false);
  }

  const tableText = r => (/^\d+$/.test(String(r.table)) ? `第 ${r.table} 桌` : String(r.table)) +
    (r.area ? `（${r.area}）` : '');
  let text;
  if (found.length === 1) {
    const r = found[0];
    text = `🎉 ${r.name} 你好！\n\n你的座位在：\n🪑 ${tableText(r)}` + (r.note ? `\n\n📝 ${r.note}` : '') +
      '\n\n謝謝你來參加我們的婚禮 💕';
  } else {
    text = '找到這幾位：\n\n' + found.map(r => `🪑 ${r.name} → ${tableText(r)}`).join('\n') +
      '\n\n謝謝你來參加我們的婚禮 💕';
  }
  const messages = [{ type: 'text', text }];
  const map = s['座位圖網址'];
  if (/^https:\/\//.test(map)) messages.push({ type: 'image', originalContentUrl: map, previewImageUrl: map });
  reply_(ev.replyToken, messages);
}

function seatOpen_() {
  const s = settings_();
  if (s['座位查詢開放'] === '是') return true;
  const at = s['座位開放時間'];
  const d = at instanceof Date ? at : (at ? new Date(String(at)) : null);
  return !!(d && !isNaN(d) && new Date() >= d);
}

/** exactOnly=true 只找全名/別名完全相同的 */
function findSeats_(query, exactOnly) {
  const q = norm_(query);
  if (!q) return [];
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.seats);
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SEAT_HEADERS.length).getValues()
    .filter(r => r[0] !== '' && r[2] !== '')
    .map(r => ({
      name: String(r[0]).trim(),
      aliases: String(r[1]).split(/[,，、]/).map(norm_).filter(Boolean),
      table: r[2], area: String(r[3] || '').trim(), note: String(r[4] || '').trim(),
    }));

  const exact = rows.filter(r => norm_(r.name) === q || r.aliases.includes(q));
  if (exact.length || exactOnly || q.length < 2) return exact;
  return rows.filter(r => norm_(r.name).includes(q) || r.aliases.some(a => a.includes(q)));
}

/* ---------- 祝福 ---------- */

function replyBlessing_(ev, text) {
  const userId = ev.source.userId;
  if (!text) {
    CacheService.getScriptCache().put('state:' + userId, 'blessing', 600);
    return reply_(ev.replyToken, [{ type: 'text', text: '💐 想對新人說什麼呢？直接打字傳給我，我會好好轉交 💌' }], false);
  }
  const name = friendName_(userId);
  sheet_(SHEETS.blessings).appendRow([new Date(), clean_(name, 60), clean_(text, 2000), userId, '']);
  reply_(ev.replyToken, [{ type: 'text', text: `收到你的祝福了 🥹💕\n謝謝 ${name}，我們會好好珍藏！` }]);
}

/* ---------- 照片 ---------- */

function handleMedia_(ev) {
  const userId = ev.source.userId;
  const folderId = settings_()['照片資料夾ID'];
  logRow_(userId, ev.message.type === 'video' ? '影片' : '照片', ev.message.id);
  if (!folderId) return;

  // 一次傳很多張只回一次謝謝（回覆訊息不扣額度，但洗版很煩）
  const cache = CacheService.getScriptCache();
  if (!cache.get('photoThanks:' + userId)) {
    cache.put('photoThanks:' + userId, '1', 180);
    reply_(ev.replyToken, [{ type: 'text', text: '📸 收到！謝謝你幫我們留下美好的瞬間 🥰\n（照片已存進婚禮相簿）' }], false);
  }

  const res = UrlFetchApp.fetch(`https://api-data.line.me/v2/bot/message/${ev.message.id}/content`, {
    headers: { Authorization: 'Bearer ' + token_() }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error(`下載${ev.message.type}失敗 ${res.getResponseCode()}: ${res.getContentText().slice(0, 200)}`);
  }
  const blob = res.getBlob();
  const ext = ev.message.type === 'video' ? 'mp4' : (blob.getContentType() === 'image/png' ? 'png' : 'jpg');
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
  const who = friendName_(userId).replace(/[\\/:*?"<>|]/g, '_');
  blob.setName(`${stamp}_${who}_${ev.message.id.slice(-5)}.${ext}`);
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  sheet_(SHEETS.photos).appendRow([new Date(), clean_(friendName_(userId), 60),
    ev.message.type === 'video' ? '影片' : '照片', file.getId(), '', userId]);
}

/* =========================================================
 * 照片牆（Wall.html 透過 google.script.run 呼叫下面兩個函式）
 * ========================================================= */

function wallKeyOk_(key) {
  const k = PropertiesService.getScriptProperties().getProperty('WALL_KEY');
  return !!k && key === k;
}

/** 照片清單（新到舊）＋最近的祝福 */
function wallData(key) {
  if (!wallKeyOk_(key)) throw new Error('invalid key');
  const s = settings_();
  const visible = v => String(v).trim() !== '否';

  const ph = sheet_(SHEETS.photos);
  const photos = ph.getLastRow() < 2 ? [] : ph.getRange(2, 1, ph.getLastRow() - 1, 5).getValues()
    .filter(r => r[2] === '照片' && r[3] && visible(r[4]))
    .map(r => ({ id: String(r[3]), name: String(r[1]).replace(/^'/, ''), t: r[0] instanceof Date ? r[0].getTime() : 0 }))
    .reverse();

  const bl = sheet_(SHEETS.blessings);
  const blessings = bl.getLastRow() < 2 ? [] : bl.getRange(2, 1, bl.getLastRow() - 1, 5).getValues()
    .filter(r => r[2] && visible(r[4]))
    .map(r => ({ name: String(r[1]).replace(/^'/, ''), text: String(r[2]).replace(/^'/, '') }))
    .slice(-40).reverse();

  let basicId = CacheService.getScriptCache().get('basicId');
  if (!basicId) {
    try {
      basicId = lineApi_('https://api.line.me/v2/bot/info').basicId || '';
      CacheService.getScriptCache().put('basicId', basicId, 21600);
    } catch (e) { basicId = ''; }
  }
  return { couple: `${s['新郎']} & ${s['新娘']}`, basicId, photos, blessings };
}

/** 回傳單張照片的 data URL；只給「照片」工作表裡、沒被隱藏的檔案（避免被拿來讀你雲端硬碟的其他檔案） */
function wallPhoto(key, id) {
  if (!wallKeyOk_(key)) throw new Error('invalid key');
  const ph = sheet_(SHEETS.photos);
  const ok = ph.getLastRow() > 1 && ph.getRange(2, 1, ph.getLastRow() - 1, 5).getValues()
    .some(r => String(r[3]) === id && r[2] === '照片' && String(r[4]).trim() !== '否');
  if (!ok) return null;
  try {
    const blob = DriveApp.getFileById(id).getBlob();
    return `data:${blob.getContentType()};base64,${Utilities.base64Encode(blob.getBytes())}`;
  } catch (e) {
    return null; // 檔案已被刪除
  }
}

/* =========================================================
 * 推播（從試算表選單操作）
 * ========================================================= */

function sendSelectedBroadcast() {
  const ui = SpreadsheetApp.getUi();
  const row = selectedBroadcastRow_();
  if (!row) return;
  const sh = sheet_(SHEETS.broadcast);
  const [content, , , status] = sh.getRange(row, 1, 1, 4).getValues()[0];
  if (status === '已發送') {
    if (ui.alert('這一列已經發送過了，確定要再發一次？', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  }

  const friends = countFriends_();
  let quotaText = '';
  try {
    const q = quota_();
    quotaText = q.limit == null ? '（本方案沒有額度上限）' : `本月剩餘約 ${q.limit - q.used} 則`;
  } catch (e) { /* 查不到額度不影響發送 */ }

  const ok = ui.alert('確認發送推播',
    `將發送給全部好友（約 ${friends} 人），會用掉約 ${friends} 則訊息額度。\n${quotaText}\n\n` +
    `內容預覽：\n${String(content).slice(0, 200)}`, ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  const result = broadcastRow_(row);
  ui.alert(result.ok ? '✅ 已發送！' : '❌ 發送失敗：\n' + result.error);
}

function testSelectedBroadcast() {
  const ui = SpreadsheetApp.getUi();
  const row = selectedBroadcastRow_();
  if (!row) return;
  const adminId = settings_()['管理員userId'];
  if (!/^U[0-9a-f]{32}$/.test(adminId)) {
    return ui.alert('請先在「設定」工作表填入「管理員userId」\n（加官方帳號好友後，到「好友」工作表找你自己那列的 userId）');
  }
  try {
    lineApi_('https://api.line.me/v2/bot/message/push', { to: adminId, messages: broadcastMessages_(row) });
    ui.alert('✅ 已發給你自己，打開 LINE 看看效果吧！（會用掉 1 則額度）');
  } catch (err) {
    ui.alert('❌ 失敗：\n' + err.message);
  }
}

/** 給時間觸發器呼叫：發送「預定時間」已到、尚未發送的推播 */
function sendDueBroadcasts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const sh = sheet_(SHEETS.broadcast);
    if (sh.getLastRow() < 2) return;
    const now = new Date();
    sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach((r, i) => {
      const [content, , when, status] = r;
      if (content && when instanceof Date && when <= now && !status) broadcastRow_(i + 2);
    });
  } finally {
    lock.releaseLock();
  }
}

/** 依 COUNTDOWN_TEMPLATES 在「推播」工作表加入倒數推播，並開啟排程 */
function createCountdownBroadcasts() {
  const ui = SpreadsheetApp.getUi();
  const wedding = weddingDate_();
  if (!wedding) {
    return ui.alert('請先在「設定」工作表填「婚禮開始時間」（例如 2027/5/1 12:00）');
  }
  const sh = sheet_(SHEETS.broadcast);
  const existing = sh.getLastRow() > 1 ? sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues()
    .map(r => (r[0] instanceof Date ? r[0].getTime() : 0)) : [];
  const now = new Date();
  const added = [];
  const skipped = [];
  COUNTDOWN_TEMPLATES.forEach(([daysBefore, hour, tpl]) => {
    const when = new Date(wedding.getTime());
    when.setDate(when.getDate() - daysBefore);
    when.setHours(hour, 0, 0, 0);
    const label = `婚禮前 ${daysBefore} 天（${Utilities.formatDate(when, TZ, 'M/d HH:mm')}）`;
    if (when <= now) return skipped.push(label + '：時間已過');
    if (existing.includes(when.getTime())) return skipped.push(label + '：已經建立過');
    sh.appendRow([fillVars_(tpl, {}), '', when, '', '', '']);
    added.push(label);
  });
  if (added.length) enableScheduler();
  ui.alert('婚禮倒數推播',
    (added.length ? `✅ 已加入「推播」工作表並開啟排程：\n・${added.join('\n・')}\n\n內容可以直接在工作表裡改；不想發就刪掉那列。\n` : '') +
    (skipped.length ? `\n略過：\n・${skipped.join('\n・')}\n` : '') +
    '\n⚠️ 每則推播會用掉「好友人數」則額度，可用選單「📊 查詢本月訊息額度」確認。', ui.ButtonSet.OK);
}

function enableScheduler() {
  disableScheduler(true);
  ScriptApp.newTrigger('sendDueBroadcasts').timeBased().everyMinutes(5).create();
  toast_('已開啟：每 5 分鐘檢查一次「推播」工作表，預定時間到了就自動發送');
}

function disableScheduler(silent) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sendDueBroadcasts')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (silent !== true) toast_('已關閉排程推播');
}

function showQuota() {
  const ui = SpreadsheetApp.getUi();
  try {
    const q = quota_();
    ui.alert('本月訊息額度',
      (q.limit == null ? '方案：沒有上限\n' : `上限：${q.limit} 則\n`) +
      `已使用：${q.used} 則\n` +
      (q.limit == null ? '' : `剩餘：${q.limit - q.used} 則\n`) +
      `\n目前好友約 ${countFriends_()} 人（推播一次 = 好友人數 則）\n` +
      '※ 回覆訊息（查座位、婚禮資訊等）不扣額度', ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('查詢失敗：\n' + err.message);
  }
}

function broadcastRow_(row) {
  const sh = sheet_(SHEETS.broadcast);
  sh.getRange(row, 4).setValue('發送中');
  SpreadsheetApp.flush();
  try {
    lineApi_('https://api.line.me/v2/bot/message/broadcast', { messages: broadcastMessages_(row) },
      { 'X-Line-Retry-Key': Utilities.getUuid() });
    sh.getRange(row, 4, 1, 3).setValues([['已發送', new Date(), `約 ${countFriends_()} 人`]]);
    return { ok: true };
  } catch (err) {
    sh.getRange(row, 4, 1, 3).setValues([['失敗', new Date(), err.message.slice(0, 500)]]);
    return { ok: false, error: err.message };
  }
}

function broadcastMessages_(row) {
  const [content, image] = sheet_(SHEETS.broadcast).getRange(row, 1, 1, 2).getValues()[0];
  const messages = [];
  if (String(content).trim()) messages.push({ type: 'text', text: String(content).slice(0, 5000) });
  if (/^https:\/\//.test(String(image).trim())) {
    const url = String(image).trim();
    messages.push({ type: 'image', originalContentUrl: url, previewImageUrl: url });
  }
  if (!messages.length) throw new Error('第 ' + row + ' 列沒有內容');
  return messages;
}

function selectedBroadcastRow_() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  const row = sh.getActiveRange() && sh.getActiveRange().getRow();
  if (sh.getName() !== SHEETS.broadcast || !row || row < 2) {
    ui.alert('請先到「推播」工作表，點選要發送的那一列（第 2 列以後）再按一次');
    return 0;
  }
  if (!String(sh.getRange(row, 1).getValue()).trim() && !String(sh.getRange(row, 2).getValue()).trim()) {
    ui.alert('這一列沒有內容');
    return 0;
  }
  return row;
}

function quota_() {
  const q = lineApi_('https://api.line.me/v2/bot/message/quota');
  const used = lineApi_('https://api.line.me/v2/bot/message/quota/consumption').totalUsage;
  return { limit: q.type === 'limited' ? q.value : null, used };
}

/* =========================================================
 * 好友名單 / 紀錄
 * ========================================================= */

/** 新增或更新好友資料，回傳 LINE 名稱 */
function upsertFriend_(userId, status, isFollow) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_(SHEETS.friends);
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
    const idx = ids.indexOf(userId);
    const now = new Date();
    if (idx === -1) {
      const name = fetchName_(userId);
      sh.appendRow([userId, clean_(name, 60), now, status, now]);
      return name;
    }
    const row = idx + 2;
    let name = String(sh.getRange(row, 2).getValue());
    if (isFollow) {
      name = fetchName_(userId) || name; // 重新加入時順便更新名稱
      sh.getRange(row, 2, 1, 4).setValues([[clean_(name, 60), now, status, now]]);
    } else {
      sh.getRange(row, 4, 1, 2).setValues([[status, now]]);
    }
    return name;
  } finally {
    lock.releaseLock();
  }
}

function friendName_(userId) {
  const sh = sheet_(SHEETS.friends);
  if (sh.getLastRow() < 2) return '朋友';
  const hit = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().find(r => r[0] === userId);
  return (hit && String(hit[1]).replace(/^'/, '')) || '朋友';
}

function fetchName_(userId) {
  try {
    return lineApi_('https://api.line.me/v2/bot/profile/' + userId).displayName || '';
  } catch (e) {
    return '';
  }
}

function countFriends_() {
  const sh = sheet_(SHEETS.friends);
  if (sh.getLastRow() < 2) return 0;
  return sh.getRange(2, 4, sh.getLastRow() - 1, 1).getValues().filter(r => r[0] === '好友').length;
}

function logRow_(userId, type, content) {
  try {
    sheet_(SHEETS.log).appendRow([new Date(), userId ? clean_(friendName_(userId), 60) : '', type,
      clean_(content, 2000), userId || '']);
  } catch (e) { /* 紀錄失敗不影響回覆 */ }
}

/* =========================================================
 * 小工具
 * ========================================================= */

let settingsCache_ = null;
function settings_() {
  if (settingsCache_) return settingsCache_;
  const sh = sheet_(SHEETS.settings);
  const map = {};
  DEFAULT_SETTINGS.forEach(([k, v]) => { map[k] = v; });
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(([k, v]) => {
      if (k) map[String(k).trim()] = v instanceof Date ? v : String(v).trim();
    });
  }
  return (settingsCache_ = map);
}

function weddingDate_() {
  const v = settings_()['婚禮開始時間'];
  const d = v instanceof Date ? v : (v ? new Date(String(v)) : null);
  return d && !isNaN(d) ? d : null;
}

/** 距離婚禮還有幾天（以台北日期算，今天 = 0）；沒填日期回傳 null */
function daysUntilWedding_() {
  const d = weddingDate_();
  if (!d) return null;
  const day = x => {
    const [y, m, dd] = Utilities.formatDate(x, TZ, 'yyyy-M-d').split('-').map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((day(d) - day(new Date())) / 86400000);
}

function fillVars_(tpl, extra) {
  const vars = Object.assign({}, settings_(), extra);
  return String(tpl).replace(/\{([^{}]+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? vars[k] : m))
    .replace('{name}', '你');
}

function reply_(replyToken, messages, withQuick) {
  if (!replyToken) return;
  if (withQuick !== false) {
    messages[messages.length - 1].quickReply = {
      items: QUICK_ITEMS.map(label => ({ type: 'action', action: { type: 'message', label, text: label } })),
    };
  }
  lineApi_('https://api.line.me/v2/bot/message/reply', { replyToken, messages });
}

function lineApi_(url, payload, extraHeaders) {
  const opt = {
    method: payload ? 'post' : 'get',
    headers: Object.assign({ Authorization: 'Bearer ' + token_() }, extraHeaders || {}),
    muteHttpExceptions: true,
  };
  if (payload) {
    opt.contentType = 'application/json';
    opt.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 300) throw new Error(`LINE API ${code}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

function token_() {
  const t = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  if (!t) throw new Error('尚未設定 Channel Access Token（選單 ② ）');
  return t;
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error(`找不到「${name}」工作表，請先執行 setup()`);
  return sh;
}

function ensureSheet_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#ffc8d8');
  sh.setFrozenRows(1);
  return sh;
}

function findSettingRow_(sh, key) {
  const keys = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues().map(r => r[0]);
  const i = keys.indexOf(key);
  return i === -1 ? 0 : i + 1;
}

/** 比對用：去空白、轉小寫、全形英數轉半形 */
function norm_(s) {
  return String(s == null ? '' : s)
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '').toLowerCase();
}

/** 截斷長度，並避免以 = + - @ 開頭的文字被試算表當成公式執行 */
function clean_(v, max) {
  let s = String(v == null ? '' : v).trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function toast_(msg) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(msg, '💍 LINE 小幫手', 8);
  } catch (e) {
    Logger.log(msg);
  }
}

function text_(s) {
  return ContentService.createTextOutput(s);
}
