// 月汐 Lunaria 設定
// 1. 到 Supabase 開一個新專案（不要和資產羅盤共用）
// 2. Project Settings → API：把 Project URL 和 publishable（anon）key 貼在下面
//    ⚠️ 只能貼 publishable / anon key，絕對不要貼 secret / service_role key
// 留空＝本機模式（資料只存在這台裝置，無法和伴侶連動）
window.LUNARIA_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
