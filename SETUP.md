# 婚禮意願調查表：串接 Google Sheet

## 1. 建立試算表與 Apps Script

1. 到 [Google Sheets](https://sheets.new) 新增一份空白試算表，取名例如「婚禮出席統計」。
2. 上方選單「擴充功能 → Apps Script」。
3. 把 `apps-script/Code.gs` 的內容整份貼上，取代原本的程式碼，按 💾 儲存。
4. 上方函式選單選 `setup` → 按「執行」。
   第一次會要求授權：選你的帳號 →「進階」→「前往（不安全）」→「允許」。
   回到試算表，會看到「回覆」和「統計」兩個工作表。

## 2. 部署成網頁應用程式

1. Apps Script 右上「部署 → 新增部署作業」。
2. 齒輪選「網頁應用程式」。
3. 設定：
   - 執行身分：**我**
   - 誰可以存取：**所有人**
4. 按「部署」，複製「網頁應用程式網址」（`https://script.google.com/macros/s/.../exec`）。
5. 用瀏覽器打開這個網址，看到 `{"ok":true,...}` 就代表成功。

## 3. 填進網頁

打開 `index.html`，找到 `CONFIG`，把網址貼到 `sheetUrl`：

```js
sheetUrl: "https://script.google.com/macros/s/xxxxxxxx/exec",
```

順便把新郎、新娘、日期、地點等資訊改好，push 上 GitHub 即可。

## 之後改了 Code.gs 怎麼辦？

「部署 → 管理部署作業」→ 鉛筆圖示 → 版本選「新版本」→ 部署。
這樣網址不會變，網頁不用改。
（如果是「新增部署作業」會產生新網址，就要回去改 `sheetUrl`。）
