/* 運転日報アプリ 環境設定
 * 試験運用は Supabase + 架空マスターです。
 * 日報入力は公開キー、履歴・月次集計は管理者認証で権限分離しています。
 */
window.APP_CONFIG = Object.freeze({
  appVersion: "5.3.0",
  mode: "supabase", // "demo" | "supabase" | "api"
  apiBaseUrl: "",
  publicAppUrl: "https://kimu080883.github.io/survey/index.html",
  supabaseUrl: "https://ofrpludsknfvgdxrodfa.supabase.co",
  supabasePublishableKey: "sb_publishable_KwKPQcuQE_nh-EtStqI0Zw_8DKQSgNE",
  masterDataUrl: "./master-demo.json",
  requestTimeoutMs: 12000,
  companyName: "東急軌道工業",
  monthlyCloseDay: 1,
  authMode: "publishable-key",
  dataNotice: "試験用の架空データです"
});
