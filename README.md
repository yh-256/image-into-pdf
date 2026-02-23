# PDF Image Editor

ブラウザ上で PDF を表示し、画像を重ねて配置したうえで新しい PDF として書き出せるシンプルなエディタです。  
Vite + TypeScript で構成され、PDF の表示には `pdfjs-dist`、書き出しには `pdf-lib` を使っています。

## 主な機能

- PDF の読み込み（`Open PDF` ボタン / ドラッグ&ドロップ）
- ページ移動（`Prev` / `Next`）
- ズーム（25% から 400%）
- PNG/JPEG 画像の追加
- 画像の移動（ドラッグ）
- 画像のリサイズ（四隅ハンドル）
- 画像を埋め込んだ PDF のエクスポート

## 画面と操作

1. `Open PDF` で編集対象の PDF を読み込む（または中央キャンバスへドロップ）
2. `Add Image` で PNG/JPEG を追加
3. 追加した画像をクリックして選択
4. ドラッグで移動、四隅ハンドルでサイズ変更
5. `Export PDF` で編集結果をダウンロード

### 操作仕様

- 画像は現在表示中のページに追加されます
- リサイズ時は縦横比を維持します
- `Alt` キーを押しながらリサイズすると縦横比を維持しない自由変形になります
- 最小サイズは 24px 相当です
- 出力ファイル名は元ファイル名に `-edited` を付与します  
  例: `sample.pdf` -> `sample-edited.pdf`

## セットアップ

### 前提

- Node.js（推奨: 現行 LTS）
- pnpm

### インストール

```bash
pnpm install
```

### 開発サーバー起動

```bash
pnpm dev
```

デフォルトでは `http://localhost:5173` で起動します。

### ビルド

```bash
pnpm build
```

### ビルド結果のプレビュー

```bash
pnpm preview
```

## 品質チェック

```bash
pnpm check
```

`check` は次を順番に実行します。

- `pnpm run format:check`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run knip`
- `pnpm run build`

個別に実行したい場合:

```bash
pnpm run format
pnpm run format:check
pnpm run lint
pnpm run lint:fix
pnpm run typecheck
pnpm run knip
```

## プロジェクト構成

```text
.
├─ public/
│  ├─ cmaps/                 # pdf.js 用 CMap
│  └─ vite.svg
├─ src/
│  ├─ export/
│  │  └─ toPdf.ts            # 画像を埋め込んだ PDF 出力
│  ├─ pdf/
│  │  ├─ loader.ts           # PDF 読み込み
│  │  ├─ renderer.ts         # PDF ページ描画
│  │  └─ worker.ts           # pdf.js worker 初期化
│  ├─ main.ts                # UI / 状態管理 / 操作イベント
│  └─ style.css              # スタイル
├─ index.html
├─ package.json
└─ tsconfig.json
```

## 実装メモ

- PDF レンダリング: `pdfjs-dist`
- PDF 出力: `pdf-lib`
- 画像オブジェクトはページ番号と PDF 座標系で管理し、表示時に viewport 座標へ変換
- 高 DPI 画面でも表示が崩れにくいよう `devicePixelRatio` を考慮して描画
- PDF 解析のため `public/cmaps` を参照（`cMapUrl: "/cmaps/"`）

## 既知の制約

- 既存 PDF 内の画像・テキストそのものは編集できません（画像追加のみ）
- 追加画像の削除機能は未実装
- 画像の回転・透過率変更・前後順変更は未実装
- 対応画像形式は PNG/JPEG のみ

## トラブルシューティング

- `Load a PDF before adding images` が表示される  
  -> 先に PDF を読み込んでください。

- `Please choose a PDF file` が表示される  
  -> `application/pdf` として認識される PDF を選択してください。

- `Export failed` が表示される  
  -> 画像形式が PNG/JPEG か確認し、ブラウザを再読み込みして再実行してください。

