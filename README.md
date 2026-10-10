# 月汐 Lunaria

經期、排卵與身體節奏紀錄。妳記錄，伴侶只看妳允許的部分。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`style.css`、`app.js`、`cycle.js` | App 本體 |
| `config.js` | 填 Supabase 網址與 publishable key |
| `manifest.webmanifest`、`sw.js`、`icon*.{svg,png}` | 可安裝到手機主畫面 |
| `supabase/schema.sql` | 資料庫結構與權限 |
| `supabase/functions/cal/index.ts` | 行事曆訂閱（提醒）函式 |

## 一、建立 Supabase（約 10 分鐘）

1. 到 supabase.com → **New project**（建議和資產羅盤分開，名稱例如 `lunaria`）。
2. **SQL Editor** → 貼上 `supabase/schema.sql` 全部內容 → **Run**。看到 Success 即可。
3. **Authentication → Providers → Email**：保持開啟。若不想收驗證信，可關掉 *Confirm email*。
4. **Project Settings → API**：複製 *Project URL* 和 *publishable*（或 *anon*）key，貼進 `config.js`。
   - ⚠️ 只能貼 publishable / anon key，**不要**貼 secret / service_role key。

## 二、行事曆提醒函式

1. **Edge Functions → Deploy a new function → Via Editor**。
2. **Function name 先改成 `cal`**，再把 `supabase/functions/cal/index.ts` 整份貼上 → Deploy。
3. 部署後到函式的 **Settings**，把 **Verify JWT 關掉**（行事曆 App 沒有登入狀態，改用網址裡的金鑰驗證）。

## 三、放上 GitHub Pages

1. GitHub 新增 repo（例如 `lunaria`）。免費版 Pages 需要 Public repo；放在 GitHub 的只有程式，妳的紀錄都在 Supabase。
2. 上傳本資料夾所有檔案（含已填好的 `config.js`）。
3. **Settings → Pages → Branch: main / root → Save**，約 1 分鐘後就有網址。

## 四、開始使用

**妳（iPhone）**：Safari 打開網址 → 分享 → 加入主畫面 → 註冊 → 選「我要記錄自己的週期」。

**他（Android）**：Chrome 打開同一個網址 → 右上角 ⋮ →「安裝應用程式」或「加到主畫面」→ 註冊自己的帳號 → 選「我是伴侶」→ 輸入妳在「我的 → 伴侶連動」產生的邀請碼。

**行事曆提醒**：各自在「我的 → 行事曆提醒」產生網址。
- Android：電腦開 calendar.google.com →「其他日曆」＋ →「透過網址新增」→ 貼上 → 手機 Google 日曆會同步，可在該日曆設定通知。
- iPhone：設定 → 行事曆 → 帳號 → 加入帳號 → 其他 →「加入已訂閱的行事曆」。

## 誰看得到什麼

| 內容 | 妳 | 伴侶 |
|---|---|---|
| 經期紀錄、排卵期、節奏（平均週期、平均生理期、下次月經、預計排卵日） | ✓ | ✓ |
| 親密紀錄 | ✓ | ✓（也可以新增） |
| 藥物提醒、健康追蹤 | ✓ | ✓（唯讀） |
| 症狀、心情、睡眠、體溫、性慾、排卵試紙、分泌物、備註 | ✓ | ✗ |
| 避孕資訊 | ✓ | ✗ |

權限是在資料庫層級設定的（Row Level Security），不是只在畫面上藏起來。伴侶端只會拿到「已算好的排卵日」，拿不到妳的體溫數字。任何一方都可以在「我的」解除連動。

## 排卵怎麼算

1. **基礎體溫（最準）**：連續 3 天高於前 6 天最高溫，且第 3 天高 0.2°C 以上 → 判定排卵在升溫前一天。
2. **排卵試紙**：第一個陽性／強陽的隔天。和體溫相差 2 天內時取中間。
3. **分泌物**：最後一個蛋清狀／水狀的日子。
4. **推算**：下次月經 − 黃體期（有確認過的週期就用妳自己的黃體期，否則 14 天），並顯示 ± 誤差天數。

確認排卵後，下次月經改用「排卵日＋黃體期」推算，比用平均週期準。

> 預測與排卵判斷僅供參考，不能取代醫療建議，也不建議單獨作為避孕方法。
