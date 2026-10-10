# 資產羅盤 Asset Compass

個人資產 Web App（PWA）：銀行帳戶、信用卡自動扣款、台股、加密貨幣，一頁看淨資產。
架構與「插單 Capture Pad」相同：**GitHub Pages（前端） + Supabase（資料庫＋登入＋兩支函式）**。

| 功能 | 怎麼運作 |
|---|---|
| 銀行帳戶 | 台幣／外幣帳戶，手動對帳或存提；外幣依即時匯率換算台幣 |
| 信用卡 | 每張卡設定**結帳日**與**扣款日**（例：29 日結帳、次月 13 日扣款）。扣款日當天開 App，自動把那期帳單從扣款帳戶扣除並留下紀錄；兩台裝置同時開也不會重複扣 |
| iOS 捷徑 | Apple Pay 刷卡 → 捷徑自動化 → 寫入 App，對應到正確卡片 |
| 信用卡回饋 | 每張卡可設基本回饋與加碼（地區、支付方式、單筆門檻、商家關鍵字、依上月消費分級），各自依帳單週期封頂；每筆消費自動算回饋，卡片頁顯示本期預估回饋與各項上限進度；「這筆刷哪張？」依剩餘上限排出最划算的卡 |
| 應收款／分期負債 | 應收款可標記「已收到」並存入帳戶；信用卡分期、貸款設定每期金額與下次扣款日，到期自動記進信用卡帳單或從帳戶扣除；總覽顯示資產分配比與負債比 |
| 台股 | 填代號＋股數（零股可）＋平均成本，自動抓即時價／收盤價算市值與損益 |
| 加密貨幣 | 交易所持倉手動填數量；MetaMask／Binance Wallet 填**公開地址**自動讀鏈上餘額；BTC 地址也可 |
| 總覽 | 淨資產＝銀行＋台股＋加密－未扣卡費；即將扣款與「扣後餘額」試算；每日淨資產走勢 |

不設定 Supabase 也能先打開 `index.html` 試用（本機模式，設定頁有「載入範例資料」）。

---

## 一、建立 Supabase 專案（約 10 分鐘）

1. 到 supabase.com → New project。Region 建議選 **Tokyo** 或 **Singapore**（離台灣近）。
2. 左側 **SQL Editor** → 貼上 `supabase/schema.sql` 全部內容 → Run。（如果之前已經建過資料表，只要執行檔案最後那幾行 `alter table` 即可）
3. **Authentication → Sign In / Providers → Email**：保持開啟。若不想收確認信，可關掉 *Confirm email*。
4. **Project Settings → API**：記下 `Project URL` 和 `anon`（或 `publishable`）key。

## 二、部署兩支 Edge Functions

在 Dashboard 左側 **Edge Functions → Deploy a new function → Via Editor**：

| 函式名稱（要一字不差） | 貼上的檔案 | Verify JWT |
|---|---|---|
| `tw-quote` | `supabase/functions/tw-quote/index.ts` | 保持**開啟** |
| `shortcut-ingest` | `supabase/functions/shortcut-ingest/index.ts` | **關閉**（捷徑沒有登入狀態，改用 App 產生的金鑰驗證） |

> 會用 CLI 的話：`supabase functions deploy tw-quote` 與 `supabase functions deploy shortcut-ingest --no-verify-jwt`。
> `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 這兩個環境變數 Supabase 會自動提供，不用另外設。

## 三、放上 GitHub Pages

1. 打開 `config.js`，填入第一步的 URL 與 anon key。（anon key 本來就是公開的；**service_role key 絕對不要放進來**。）
2. 在 GitHub 建新 repo（例如 `asset-compass`），把整個資料夾內容上傳（`supabase/` 資料夾一起放無妨）。
   ⚠️ 建議 repo 設為 **Private** 再開 Pages 需要付費方案；若用 Public，程式碼公開沒關係，資料都在 Supabase 且有 RLS 保護，只有登入的你看得到。
3. repo → Settings → Pages → Branch 選 `main` / root → Save。
4. 手機 Safari 打開網址 → 分享 → **加入主畫面**。第一次點「註冊帳號」，之後用同一組登入。

## 四、App 內初始設定

1. **銀行**：新增帳戶並填目前餘額。
2. **信用卡**：`config.js` 裡的 `presetCards` 已預先放好聯邦吉鶴卡、聯邦 MaiCoin 聯名卡（29 日結帳／13 日扣款）與星展卡（28 日結帳／16 日扣款），第一次登入會自動建立。每張卡請到「卡片設定」確認：
   - 每月結帳日、每月扣款日（小月沒有該日會取月底；扣款日留空 = 結帳日當天扣）
   - 扣款帳戶
   - **Apple 錢包裡的卡片名稱**（捷徑比對用，填錢包上顯示名字的一部分即可，例如 `MaiCoin`）
3. **台股**、**加密**：新增持股、持倉與錢包地址。
4. **設定 → 產生金鑰**，複製起來給捷徑用。

---

## 五、iOS 捷徑：Apple Pay 刷卡自動記帳

> 以下依 iOS 17 起的「交易」自動化流程撰寫；iOS 27 若選單名稱略有不同，找「交易／Transaction」觸發條件即可。

1. 打開 **捷徑 App → 自動化 → ＋ → 交易（Transaction）**。
2. **卡片**：勾選要記帳的卡（可多選，一個自動化就能涵蓋全部）。類別可全選。
3. 選 **立即執行**（不要選「執行前詢問」），下一步 → 新增空白自動化。
4. 加入動作 **「取得 URL 內容」**，設定：
   - URL：`https://你的專案.supabase.co/functions/v1/shortcut-ingest`（設定頁有完整網址可複製）
   - 方法：**POST**
   - 標頭：新增 `x-ingest-token`，值貼上 App 產生的金鑰
   - 要求本文：**JSON**，新增 3 個欄位（值都點「捷徑輸入」後選對應變數）：
     - `amount` → **金額**（Amount）
     - `merchant` → **商家**（Merchant）
     - `card` → **卡片或票卡**（Card or Pass）
5. （選用）再加 **「取得字典值」** 鍵 `message` → **「顯示通知」**，刷完會跳出「已記錄 MaiCoin 卡：NT$120 · 7-ELEVEN」。

**要知道的限制**
- 只有 **Apple Pay（手機／手錶感應、App 內 Apple Pay）** 會觸發。實體卡刷卡、網購輸入卡號、LINE Pay 綁卡**不會**觸發，這些請在 App 按「＋ 記一筆」。
- 外幣交易會依當下匯率先估台幣；帳單出來後可點那筆把「台幣入帳金額」改成實際金額（含海外手續費）。
- 若通知顯示「未對應卡片」，到信用卡頁把那筆指定卡片，並補上該卡的「錢包名稱」。

**本機模式的替代做法**：捷徑改用「打開 URL」：
`https://你的網址/#add?amount=[金額]&merchant=[商家]&card=[卡片或票卡]`，App 會跳出已填好的表單讓你確認。

---

## 資料來源與安全

- 匯率：open.er-api.com（每 6 小時更新快取）
- 台股：證交所即時資訊（盤中），抓不到時用證交所／櫃買中心 OpenAPI 收盤價
- 加密貨幣價格：CoinGecko（新台幣計價）；鏈上餘額：publicnode RPC、mempool.space
- 錢包只存**公開地址**，App 不會、也不需要助記詞或私鑰。
- 每個資料表都開了 RLS，只有你的帳號讀寫得到自己的資料。
- 設定頁可隨時「匯出 JSON 備份」。
- 右上角 ◐ 可一鍵隱藏所有金額（在外面打開時用）。

## 檔案結構

```
index.html  style.css  app.js  config.js   前端
manifest.webmanifest  sw.js  icon*         PWA（加入主畫面、離線殼層）
supabase/schema.sql                        資料表＋RLS
supabase/functions/tw-quote/               台股報價代理
supabase/functions/shortcut-ingest/        捷徑寫入端點
```
