# FieldLog Mini (GitHub Pages / Offline PWA)

## できること（最小）
- 写真を撮る/選ぶ
- GPS取得（緯度/経度/精度）
- 備考（テキスト、必要なら音声入力）
- 端末内(IndexedDB)に保存
- CSV出力（QGISで読み込み想定：lat/lon 列あり）
- PWA(オフライン動作)：アプリ本体はキャッシュ、データは端末に保持

## GitHub Pages に置く手順（最短）
1) GitHub で新規リポジトリ作成（Public）
2) このフォルダの中身をリポジトリ直下にアップロード
3) リポジトリ Settings → Pages → Source を「main / root」にして保存
4) 表示されたURLへアクセス

## 重要な注意（音声入力）
- Web Speech API はブラウザ依存で、オフライン不可/外部送信の可能性があります。
- 使えない端末では、備考欄に手入力してください。


v1.4 追加: 地点/項目プルダウン + CSV読み込み（ヘッダ: 地点,項目）
