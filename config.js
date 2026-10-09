// 填入你的 Supabase 專案資訊（Dashboard → Project Settings → API）
// 兩個都留空 = 本機試用模式：資料只存在這個瀏覽器、捷徑只能用「打開網址」方式、台股抓不到即時價。
// anon / publishable key 本來就是公開金鑰，放在前端沒問題；資料安全由資料庫的 RLS 保護。
// 絕對不要把 service_role / secret key 放在這裡。
window.ASSET_CONFIG = {
  supabaseUrl: "https://bpunpkpxhqescvzgntve.supabase.co", 
  supabaseAnonKey: "sb_publishable_-ChzU0gGzm277UPLJHDUiA_YgX4A7lf", 

  // 第一次開啟、帳號裡還沒有任何信用卡時，自動建立這些卡片（之後在 App 裡修改即可）
  // closing_day = 每月結帳日，due_day = 每月扣款日（結帳後的下一個該日）
  // wallet_name = Apple 錢包裡卡片名稱的一部分，iOS 捷徑靠它對應卡片
  presetCards: [
    { name: "聯邦吉鶴卡", wallet_name: "吉鶴", closing_day: 29, due_day: 13, color: "#8a63b8" },
    { name: "聯邦 MaiCoin 聯名卡", wallet_name: "MaiCoin", closing_day: 29, due_day: 13, color: "#b8893a" },
    { name: "星展卡", wallet_name: "星展", closing_day: 28, due_day: 16, color: "#c0623f" },
    { name: "永豐 DAWHO 現金回饋卡", wallet_name: "DAWHO", closing_day: 20, due_day: 6, color: "#4f9a92" },
    { name: "永豐 DAWAY 卡", wallet_name: "DAWAY", closing_day: 20, due_day: 6, color: "#5b72c4" },
  ],
  // 回饋規則會依卡名自動套用建議值（吉鶴、MaiCoin、星展、DAWHO、DAWAY），可在 App 的卡片頁「回饋」區修改
};
