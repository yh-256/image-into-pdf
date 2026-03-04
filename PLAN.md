## 0. ゴール定義（DoD）

* ローカルPDFを開ける（通信なし）
* 任意ページに画像を配置できる（ドラッグ）
* 画像をリサイズできる（四隅ハンドル）
* 編集結果を **PDFとしてダウンロード** できる
* 主要ブラウザで動く（Chrome/Edge/Safari想定）
* ページ表示がボケない（Retina対応）

---

## 1. 技術スタック確定

* ビルド：Vite + TypeScript（Vanilla）
* PDF表示：pdfjs-dist（PDF.js）
* PDF書き出し：pdf-lib（既存PDFを改変して画像を埋め込む。ブラウザでも動く） ([pdf-lib.js.org][1])
* UI：Canvas（PDF描画Canvas + 操作用Overlay Canvas）

> PDF.jsは「表示」、pdf-libは「保存」。役割分担が前提。

---

## 2. プロジェクトセットアップ（最初の30分で完了させる）

### 2.1 作成

```bash
pnpm create vite pdf-image-editor --template vanilla-ts
cd pdf-image-editor
pnpm install
```

### 2.2 依存追加

```bash
pnpm add pdfjs-dist pdf-lib
pnpm add -D @types/node
```

### 2.3 ディレクトリ設計（最小で破綻しない分割）

```
src/
  main.ts
  app/
    state.ts            # 編集状態（page, zoom, objects）
  pdf/
    loader.ts           # PDF読み込み（ArrayBuffer→PDF.js doc）
    renderer.ts         # 1ページ描画（viewport/scale/DPR対応）
    worker.ts           # workerSrc設定
  editor/
    overlay.ts          # Overlay Canvas描画
    hitTest.ts          # 選択/ハンドル判定
    transform.ts        # viewport座標⇄PDF座標
    interactions.ts     # pointer events（drag/resize）
  export/
    toPdf.ts            # pdf-libで画像埋め込み→Uint8Array
```

---

## 3. 実装計画（フェーズ別：成果物と合格条件つき）

### Phase 1：PDFを開いて表示（MVP-Viewer）

**作業**

1. ファイル入力（PDF）
2. PDF.jsでロード
3. 1ページ目をCanvasにレンダリング
4. 次/前ページ、ズーム（±）

**要点**

* PDF.jsのviewportは、スケール/回転に加えて「PDF座標（左下原点）→Canvas座標（左上原点）」変換を含む ([mozilla.github.io][2])
* 高DPI（Retina）でボケないよう、`devicePixelRatio`でCanvas実ピクセルを増やす ([MESCIUS.devlog][3])

**合格条件**

* 10ページ以上のPDFでページ送りができる
* ズームしても文字がボケにくい（DPR対応）

---

### Phase 2：PDF.js Workerを確実に動かす（詰まりポイント潰し）

**作業**

* workerSrcを設定（Vite想定）

**推奨パターン（まずこれ）**

```ts
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();
```

([Zenn][4])

**Fallback（環境で崩れる場合）**

* `pdf.worker.min.mjs` を `public/` にコピーして
* `workerSrc = "/pdf.worker.min.mjs"` に固定（ビルド後も安定しやすい） ([Stack Overflow][5])

**合格条件**

* Dev/Build両方でPDFロードが安定（ワーカー404なし）

---

### Phase 3：画像の追加（配置だけ：まだリサイズなし）

**作業**

1. 画像入力（PNG/JPEG）
2. 画像をOverlay Canvas上に描画
3. ドラッグで移動
4. 画像オブジェクトを状態として保持

**状態モデル（最低限）**

* `pageIndex`
* `rect`（PDF座標で保持するのが最終的に楽）
* `imageBytes`（Uint8Array）

**座標戦略（ここが勝負）**

* UI操作はViewport（Canvas）座標
* 状態はPDF座標に正規化して保存
  `viewport.convertToPdfPoint()` を使う（ズーム/回転に強い） ([hm.meijiang.gov.cn][6])

**合格条件**

* 画像を置ける
* ページ送りして戻っても画像が同じ場所に出る（状態保持）

---

### Phase 4：リサイズ（四隅ハンドル＋選択UI）

**作業**

1. 選択枠（バウンディングボックス）描画
2. 四隅ハンドル描画
3. hitTest（どのハンドル掴んだか判定）
4. pointer moveでリサイズ
5. Shift押しでアスペクト固定（任意だが便利）

**実装方針**

* リサイズ中は「Viewport座標の矩形」を更新
* 更新結果を都度 `convertToPdfPoint` でPDF座標に戻して state 更新
* PDF座標は左下原点、Canvasは左上原点なので変換必須 ([mozilla.github.io][2])

**合格条件**

* 画像の拡縮が直感通り
* ズームしてもリサイズ挙動が破綻しない

---

### Phase 5：PDF書き出し（最終成果）

**作業**

1. 元PDF（ArrayBuffer）をpdf-libで読み込み
2. 各ページに対応する画像オブジェクトを列挙
3. `embedPng/embedJpg` → `page.drawImage`
4. `pdfDoc.save()` → Blob → download

pdf-libはブラウザで画像埋め込み＆保存ができる ([JSFiddle][7])

**注意**

* pdf-libの座標系も基本「左下原点」なので、**stateをPDF座標で持っていればそのまま描ける**（ここがPhase3の設計理由）。

**合格条件**

* 出力PDFをPreview/Acrobatで開いて、画像が期待位置・サイズで埋め込まれている
* 複数ページ・複数画像でも崩れない

---

## 4. テスト計画（最小で効くやつ）

### 手動テストケース（必須）

* A4縦 / A4横 / 回転ページ（90度）
* 1ページ / 20ページ
* 画像：PNG（透過あり）/ JPG
* ズーム：50% / 100% / 200% の状態で配置→保存→確認
* ページ送り後に戻る（状態再描画）
* 画像をページ端ギリギリに配置して保存

### 失敗しやすい箇所（重点）

* workerのパス問題（ビルド後）
* DPR対応なしで文字がボケる
* Canvas↔PDF座標の符号・原点ミス（上下反転）

---

## 5. 仕上げ（完成度を上げるが必須ではない）

* Undo/Redo（コマンドスタック）
* スナップ（端/中央/グリッド）
* 画像のレイヤ順（前面/背面）

---

## 次にやること（即着手用）

1. Phase1の最小コード（PDF読み込み→1ページ描画→ページ送り→ズーム）を一気に書く
2. その上にOverlay Canvasを重ねる

[1]: https://pdf-lib.js.org/?utm_source=chatgpt.com "PDF-LIB · Create and modify PDF documents in any ..."
[2]: https://mozilla.github.io/pdf.js/examples/?utm_source=chatgpt.com "PDF.js - Examples"
[3]: https://devlog.mescius.jp/javascript-pdf-viewer-pdfjs/?utm_source=chatgpt.com "PDF.jsを使用してWebブラウザでPDFファイルを表示する"
[4]: https://zenn.dev/watty/articles/77657c0ac4838d?utm_source=chatgpt.com "【PDF.js】ReactでPDF.jsを使ってPDFテキストを抽出したい"
[5]: https://stackoverflow.com/questions/79044550/how-to-use-pdfjs-worker-in-react-and-typescript?utm_source=chatgpt.com "how to use pdfjs worker in react and typescript?"
[6]: https://hm.meijiang.gov.cn/js/pdf/api/draft/PDFJS.PageViewport.html?utm_source=chatgpt.com "JSDoc: Class: PageViewport"
[7]: https://jsfiddle.net/Hopding/bcya43ju/5/?utm_source=chatgpt.com "Embed PNG and JPEG Images (pdf-lib)"

