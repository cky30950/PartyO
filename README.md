# PartyO · 派對一條龍 Web App / PWA

一條龍處理派對活動建立、RSVP 報名、日曆邀請（`.ics` 與 Google Calendar）及 AA 計費收款追蹤，朋友開手機連結即可使用，無需下載安裝 App。

## 核心功能

- **活動建立與免登入 RSVP**：建立活動後自動生成專屬連結（`?party=<id>`），參加者可直接填名、切換出席／未定／缺席狀態及填寫備註（如唔飲酒、遲到）。
- **日曆建立與邀請**：
  - 一鍵下載 RFC 5545 標準 `.ics` 檔（支援 Apple Calendar、Outlook）
  - 一鍵開啟 Google Calendar 預填活動頁
  - 自動生成 WhatsApp 群組邀請範本（附活動連結與 Google Calendar 連結）
- **AA 計費與收款追蹤**：
  - 支援多人墊付、按項目剔除不參與者（例如唔飲酒人士）、按份數比例（如遲到半份）及自訂金額
  - 採用貪婪最少轉帳演算法，自動計出最少轉帳次數方案（以仙為單位精確分配餘數）
  - 支援逐筆標記 **PayMe / 轉數快 FPS / 現金已付**，並一鍵複製 WhatsApp 結算與催數清單
- **雙模式儲存（Firebase Firestore + 本機即時試用）**：
  - 未設定 Firebase 前，自動以 LocalStorage 運行（內建「載入示範派對」按鈕可即時試玩）
  - 填入 `.env.local` 後自動切換為 Firebase Firestore 雲端即時多人同步

## 本機啟動

```bash
npm install
npm run dev
```

開啟終端機顯示的網址（預設 `http://localhost:5173`）即可試用。

## 接駁 Firebase Firestore（多人雲端同步）

1. 到 [Firebase Console](https://console.firebase.google.com/) 建立新專案，啟用 **Cloud Firestore**。
2. 新增一個 **Web App**，複製設定值。
3. 將 `.env.example` 複製為 `.env.local`，填入 6 項 `VITE_FIREBASE_*` 變數：
   ```bash
   cp .env.example .env.local
   ```
4. 可將本專案的 `firestore.rules` 套用到 Firestore 安全規則，然後重新啟動 `npm run dev`，右上角標籤會自動切換為「雲端即時同步」。

## 測試與部署

```bash
# 執行 AA 結算與日曆匯出單元測試
npm test

# 建置正式版本（輸出至 dist/）
npm run build
```

部署上線可直接連接 GitHub 至 **Vercel**、**Netlify** 或使用 **Firebase Hosting**（將 `dist/` 設為發佈目錄，並在平台環境變數填入 6 項 `VITE_FIREBASE_*`）。
