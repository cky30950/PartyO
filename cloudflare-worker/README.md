# PartyO Media & AI Worker（Cloudflare R2 + Gemini OCR）

這個輕量 Cloudflare Worker 同時負責兩件事：
1. **Cloudflare R2 活動共享原圖相簿**：驗證 Firebase 登入憑證後上傳／讀取／刪除原圖與縮圖（零下載流量費）。
2. **Gemini 影相掃單自動入資料**：驗證主辦人權限後，自動將收據原圖存入 R2 並呼叫 Gemini API 辨識商戶、總金額、分類與明細摘要。

## 快速部署步驟（約 3 分鐘）

```bash
cd cloudflare-worker
npm install

# 1. 登入 Cloudflare
npx wrangler login

# 2. 建立 R2 儲存桶（需在 Cloudflare Dashboard 先開通 R2，免費方案含 10GB + 零流量費）
npx wrangler r2 bucket create partyo-media

# 3. 設定你的 Gemini API Key（從 Google AI Studio 免費取得）
npx wrangler secret put GEMINI_API_KEY

# 4. 部署 Worker
npx wrangler deploy
```

部署成功後會取得一組網址，例如：
`https://partyo-media-api.<你的子網域>.workers.dev`

## 連結到 PartyO 前端

你有兩種方式（任選其一即可）：
1. **免重新部署（推薦）**：以主辦人身分登入 PartyO，點進任一活動的「**活動相簿**」或「**費用分攤**」→ 貼上 Worker 網址並按「儲存連線設定」，即會即時同步到雲端 `/appSettings/mediaApiBase`。
2. **環境變數**：在 PartyO 根目錄 `.env` 加入 `VITE_MEDIA_API_BASE=https://partyo-media-api.<你的子網域>.workers.dev` 後重新建置。
