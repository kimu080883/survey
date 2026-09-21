# 運転日報アプリ v4 — 本番データベース接続仕様

## 切替方法

本番移行時は `app-config.js` の次の2項目だけを変更します。

```js
mode: "api",
apiBaseUrl: "https://社内APIのURL"
```

画面と入力ロジックの変更は不要です。APIはログイン済み社員をサーバー側で検証し、Cookieまたは社内SSOで認証してください。

## 必須API

### GET /masters

社員・車両マスタを返します。

```json
{
  "employees": [{"id":"E001","name":"社員名","active":true}],
  "vehicles": [{"id":"V001","no":"車両番号","name":"車名","active":true,"initialOdometer":10000}]
}
```

### GET /vehicles/{vehicleId}/state

車両の最新距離と更新番号を返します。

```json
{
  "vehicleId":"V001",
  "latestOdometer":10420.5,
  "revision":18,
  "lastReportId":"report-id",
  "lastDriverName":"社員名",
  "lastUsedDate":"2026-09-21",
  "updatedAt":"2026-09-21T08:30:00+09:00"
}
```

### POST /reports

ヘッダー `If-Match` に、画面が取得した車両の `revision` を送ります。サーバーは1トランザクション内で次を実行します。

1. 車両行をロックする
2. 現在のrevisionとIf-Matchを比較する
3. 開始距離と最新終了距離を比較する
4. 日報を保存する
5. 車両の最新距離を終了距離へ更新する
6. revisionを1増やす
7. コミットする

競合時はHTTP 409を返します。

```json
{"code":"REVISION_CONFLICT","message":"別の日報が先に保存されました","detail":{"latestOdometer":10450,"revision":19}}
```

### GET /reports?month=YYYY-MM&vehicleId=V001

条件に該当する日報配列を返します。vehicleIdは任意です。

### GET /reports/monthly-summary?month=YYYY-MM

```json
[
  {
    "vehicleId":"V001",
    "vehicleNo":"車両番号",
    "vehicleName":"車名",
    "month":"2026-09",
    "openingOdometer":10000,
    "closingOdometer":11200,
    "totalDistance":1200,
    "reportCount":28,
    "driverCount":7,
    "anomalyCount":1
  }
]
```

## 最低限必要なテーブル

- employees: 社員ID、氏名、在籍状態
- vehicles: 車両ID、車両番号、車名、最新距離、revision
- driving_reports: 日報、開始距離、終了距離、走行距離、運転者、アルコール確認
- report_audit_logs: 修正前後、修正者、日時、理由

## 本番運用ルール

- 車両番号と社員IDは表示名ではなく固定IDで関連付ける
- 距離更新は必ずデータベーストランザクションで行う
- 過去日報を直接削除せず、取消・修正履歴を残す
- 開始距離を修正した場合は理由を必須にする
- 月次確定後は一般社員による変更を禁止する
- Boxには月次CSV/PDFを保管し、毎日の同時更新先には使用しない
