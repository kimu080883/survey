/* 運転日報アプリ 環境設定
 * 試験運用は Supabase + 架空マスターです。
 * 実データ移行前に認証方式と管理者権限を追加してください。
 */
window.APP_CONFIG = Object.freeze({
  appVersion: "5.1.1",
  mode: "supabase", // "demo" | "supabase" | "api"
  apiBaseUrl: "",
  supabaseUrl: "https://ofrpludsknfvgdxrodfa.supabase.co",
  supabasePublishableKey: "sb_publishable_KwKPQcuQE_nh-EtStqI0Zw_8DKQSgNE",
  masterDataUrl: "./master-demo.json",
  requestTimeoutMs: 12000,
  companyName: "東急軌道工業",
  monthlyCloseDay: 1,
  authMode: "publishable-key",
  dataNotice: "試験用の架空データです"
});
