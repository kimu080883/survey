/* 運転日報アプリ 環境設定
 * 本番移行時は mode と apiBaseUrl を変更します。画面側の変更は不要です。
 */
window.APP_CONFIG = Object.freeze({
  appVersion: "4.0.0",
  mode: "demo", // "demo" | "api"
  apiBaseUrl: "",
  masterDataUrl: "./master-demo.json",
  requestTimeoutMs: 12000,
  companyName: "東急軌道工業",
  monthlyCloseDay: 1,
  authMode: "cookie"
});
