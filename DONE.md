# DONE.md 成果報告書

作成日: 2026-01-21
対象: /Users/hrk25/mydata/Desktop/pdf/pdf-image-editor

---

## 1. 目的（PLAN.mdより）

本プロジェクトの目的は、ローカルPDFをブラウザで開き、画像を配置・リサイズし、編集結果をPDFとしてダウンロードできるツールを構築すること。表示はPDF.js、書き出しはpdf-libで役割分担し、Retina対応で文字がボケないレンダリングを実現する。

---

## 2. 実装状況サマリ

- Phase1（PDF読み込み → 1ページ描画 → ページ送り → ズーム）: **完了**
- Phase2（PDF.js worker設定）: **完了（推奨パターン採用）**
- Phase3（画像追加・配置）: 未着手
- Phase4（リサイズ）: 未着手
- Phase5（PDF書き出し）: 未着手

---

## 3. 実装の進め方（順序・理由・方法）

### 3.1 ベース状態の把握

**目的**: 現状のコード構成と依存関係を把握し、PLAN.md Phase1の実装対象を特定する。  
**方法**: ルートとプロジェクト内を確認。

- 実行コマンド
  - `ls -la`（ルート確認）
  - `ls -la /Users/hrk25/mydata/Desktop/pdf/pdf-image-editor`
  - `ls -la /Users/hrk25/mydata/Desktop/pdf/pdf-image-editor/src`
  - `cat /Users/hrk25/mydata/Desktop/pdf/pdf-image-editor/src/main.ts`
  - `cat /Users/hrk25/mydata/Desktop/pdf/pdf-image-editor/package.json`
  - `cat /Users/hrk25/mydata/Desktop/pdf/pdf-image-editor/index.html`

**結果**: ViteのテンプレートUIが残っているため、Phase1に必要なUI・ロジックを新規構築する必要があると判断。

---

### 3.2 Phase1実装の骨子決定

**目的**: PDF読み込み・表示・ページ送り・ズームの最小実装をまず作り、今後の画像編集基盤にする。  
**理由**: PLAN.mdの「次にやること」1・2を最短で満たし、Overlay Canvasに接続可能な形にするため。

**実装方針**
- PDF.jsの読み込み・レンダリングを分割（`pdf/`配下にモジュール分離）
- DPR対応（`devicePixelRatio`で実ピクセル拡大）
- UIはボタン・ファイル入力・ページ/ズーム表示を最低限で提供
- Overlay Canvasは描画せず、サイズ同期のみ先行実装

---

### 3.3 フォルダ構成の追加

**目的**: 以降の拡張（overlay, hitTest, interactions）を見据え、PDF関連処理を分離。  
**方法**: `src/pdf`ディレクトリ作成。

- 実行コマンド
  - `mkdir -p src/pdf`

---

### 3.4 PDF.js Workerの初期化

**目的**: Dev/Buildで安定してPDF.js workerが動作するようにする（Phase2相当）。  
**理由**: worker未設定はPDF読み込みエラーの主要原因であり、初期段階で潰す必要があるため。

**実装**: `src/pdf/worker.ts`
- `GlobalWorkerOptions.workerSrc` を Vite向けの推奨パターンで指定。

```ts
import * as pdfjsLib from "pdfjs-dist";

export function initPdfWorker() {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
}
```

---

### 3.5 PDF読み込みローダの実装

**目的**: ファイル入力からArrayBufferを取得しPDF.jsに渡す処理を共通化。  
**実装**: `src/pdf/loader.ts`

```ts
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

export async function loadPdfFromFile(file: File): Promise<PDFDocumentProxy> {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data });
  return loadingTask.promise;
}
```

---

### 3.6 PDFレンダラー実装（DPR対応）

**目的**: 1ページ描画とRetina対応を担保。  
**理由**: PLAN.mdのPhase1合格条件「ズームしても文字がボケにくい」を満たす必要があるため。  
**実装**: `src/pdf/renderer.ts`

- `viewport.width/height` に対して `devicePixelRatio` 分だけ canvas 解像度を上げる
- `canvas.style.width/height` に論理解像度を設定
- `context.setTransform(dpr, 0, 0, dpr, 0, 0)` でスケール

```ts
export async function renderPageToCanvas(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  canvas: HTMLCanvasElement
): Promise<RenderResult> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context not available");
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const renderTask = page.render({
    canvasContext: context,
    viewport,
  });

  await renderTask.promise;

  return {
    page,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  };
}
```

---

### 3.7 UI/状態/操作ロジックの統合

**目的**: Phase1の操作（ファイル読み込み、ページ送り、ズーム）を一通り動かす。  
**理由**: overlayや画像編集の前提となる「PDF表示基盤」を完成させるため。  
**実装**: `src/main.ts`

**主なポイント**
- `initPdfWorker()` を起動時に呼ぶ
- `handlePdfFile` で読み込み → 初期ページ → render
- `renderCurrentPage` で再レンダリングを一本化
- 連続レンダリングの衝突を避けるために `renderToken` を導入
- Zoomは `0.25`〜`4.0` にクランプ
- Overlay Canvasは PDF Canvas と同じ解像度/サイズに同期
- Drag & Drop でも読み込み可能に

**レンダリング制御の例**
```ts
let renderToken = 0;

async function renderCurrentPage() {
  if (!pdfDoc) {
    return;
  }

  const token = ++renderToken;
  setControlsEnabled(false);
  setStatus("Rendering page...");

  try {
    await renderPageToCanvas(pdfDoc, currentPage, scale, pdfCanvas);
    if (token !== renderToken) {
      return;
    }
    syncOverlayToPdfCanvas();
    emptyState.classList.add("is-hidden");
    setStatus("Ready");
  } finally {
    if (token === renderToken) {
      setControlsEnabled(true);
      updateIndicators();
    }
  }
}
```

---

### 3.8 スタイル設計

**目的**: PDFキャンバスが中心配置され、操作UIが視認しやすい状態にする。  
**理由**: 画像配置の操作を行うためには、キャンバス領域の明確化が必要。  
**実装**: `src/style.css`

**主なポイント**
- Canvasをコンテナ中央に配置（absolute + translate）
- Overlay CanvasはPDF Canvasと完全同期
- 空状態表示、ドロップ時の視覚フィードバック
- 背景にグラデーションで視認性を向上

---

## 4. 変更ファイル一覧

- 追加
  - `src/pdf/worker.ts`
  - `src/pdf/loader.ts`
  - `src/pdf/renderer.ts`
- 変更
  - `src/main.ts`
  - `src/style.css`

---

## 5. 進捗トレース（作業順）

1. 現状調査（ファイル/依存/テンプレUIの確認）
2. Phase1に必要なモジュール分割方針を決定
3. `src/pdf` 新規作成
4. worker初期化モジュール実装
5. PDF読み込みモジュール実装
6. DPR対応レンダラー実装
7. UIと状態管理を `main.ts` に統合
8. Canvas/Overlayのレイアウトを `style.css` で調整

---

## 6. 残タスクと次アクション

- Phase3: 画像追加・配置（Overlay Canvas描画 / ドラッグ移動）
- Phase4: リサイズ（ハンドル・hitTest・座標変換）
- Phase5: PDF書き出し（pdf-libによる画像埋め込み）

---

## 7. 実行確認（未実施）

- `pnpm dev` によるローカル起動テストは未実施


---

## 8. 追記（Phase3 実装完了: 画像追加・配置）

追記日: 2026-01-21

### 8.1 進捗更新サマリ

- Phase3（画像追加・配置）: **完了**
- Phase4（リサイズ）: 未着手
- Phase5（PDF書き出し）: 未着手

---

### 8.2 追加実装の目的と前提

**目的**: PDF上に画像を配置し、ドラッグで移動できる基盤を作る。  
**前提**: 状態はPDF座標で保持し、UI操作はViewport座標で行う（PLAN.mdの座標戦略）。  
**理由**: ズーム・ページ切替時も位置が破綻しない状態管理が必要なため。

---

### 8.3 実装順序・理由・方法（トレース可能な詳細）

#### 8.3.1 レンダラー拡張（Viewport情報の受け渡し）

**理由**: PDF↔Canvasの座標変換に `PageViewport` が必須。  
**方法**: `renderPageToCanvas` の返却値に `viewport` を追加し、呼び出し側で保持できるようにした。

- 対象ファイル: `src/pdf/renderer.ts`
- 変更内容: `RenderResult` に `viewport: PageViewport` を追加

---

#### 8.3.2 Overlay Canvasのポインター操作有効化

**理由**: 画像配置のドラッグ操作はOverlay上で行うため。  
**方法**: CSSの `#overlay-canvas` を `pointer-events: auto` に変更。

- 対象ファイル: `src/style.css`

---

#### 8.3.3 画像状態モデルの追加

**目的**: 画像の位置・サイズをPDF座標で保持する。  
**実装**: `src/main.ts`

- 追加した型
  - `PdfRect { x, y, width, height }`
  - `ImageObject { id, pageIndex, rect, src }`
- 追加した状態
  - `imageObjects: ImageObject[]`
  - `selectedId: string | null`
  - `imageCache: Map<string, HTMLImageElement>`

---

#### 8.3.4 座標変換ユーティリティの実装

**理由**: Drag操作時はViewport座標、保存はPDF座標に正規化する必要があるため。  
**方法**: `PageViewport.convertToPdfPoint / convertToViewportPoint` を用いて矩形の変換関数を追加。

- 実装関数（`src/main.ts`）
  - `viewportRectToPdfRect(viewport, x, y, width, height)`
  - `pdfRectToViewportRect(viewport, rect)`

---

#### 8.3.5 Overlay描画処理の実装

**目的**: 現在ページの画像を描画し、選択中の枠を表示。  
**方法**: 画像は `imageCache` から取得し、DPRに合わせて描画。

- 主な処理（`src/main.ts`）
  - `drawOverlay()` で現在ページの画像を描画
  - `clearOverlay()` で毎回クリア
  - 選択中の画像はオレンジ枠で表示

---

#### 8.3.6 画像追加の実装（Add Image）

**目的**: PNG/JPEGを読み込み、ページ中央に配置する。  
**方法**: FileReaderでDataURL化 → Imageオブジェクト生成 → 初期サイズを算出 → PDF座標に変換して保存。

- UI追加: 「Add Image」ボタンをツールバーに追加
- 画像サイズ決定
  - 最大幅 `min(320, viewport.width * 0.6)`
  - 最小幅 `120`
  - アスペクト比維持
- 保存場所
  - `imageObjects.push(obj)` で状態保持
  - `imageCache.set(id, img)` で描画用キャッシュ保持

---

#### 8.3.7 ドラッグ移動の実装

**目的**: 画像をクリック＆ドラッグで移動できるようにする。  
**方法**:
- `pointerdown` で hitTest
- `pointermove` で差分移動
- 移動後、PDF座標に戻して `rect` を更新
- `pointerup` で dragState をクリア

- hitTestの判定順序
  - `imageObjects` を末尾から探索（最前面優先）

---

### 8.4 変更ファイル（Phase3 追記分）

- 変更
  - `src/main.ts`
  - `src/pdf/renderer.ts`
  - `src/style.css`

---

### 8.5 進捗トレース（Phase3 実装順）

1. `renderer.ts` 返却値に `viewport` を追加
2. `overlay-canvas` のポインター操作を有効化
3. 画像状態モデルを追加
4. 座標変換ユーティリティを追加
5. Overlay描画処理を追加
6. 画像追加（入力/初期配置）を実装
7. hitTest + ドラッグ移動を実装

---

### 8.6 残タスクと次アクション（更新）

- Phase4: リサイズ（ハンドル・hitTest・座標変換）
- Phase5: PDF書き出し（pdf-libによる画像埋め込み）

---

### 8.7 実行確認（未実施）

- `pnpm dev` によるローカル起動テストは未実施（Phase3 追加分も未検証）

---

## 9. 追記（Phase4 実装完了: リサイズ）

追記日: 2026-01-21

### 9.1 進捗更新サマリ

- Phase4（リサイズ）: **完了**
- Phase5（PDF書き出し）: 未着手

---

### 9.2 追加実装の目的と前提

**目的**: 選択した画像を四隅ハンドルで拡大/縮小できるようにする。  
**前提**: 状態はPDF座標で保持し、UI操作はViewport座標で行う。  
**理由**: ズーム倍率やページ切替に影響されない編集を維持するため。

---

### 9.3 実装順序・理由・方法（トレース可能な詳細）

#### 9.3.1 リサイズ状態管理の拡張

**理由**: 移動とリサイズを同一のポインター操作で区別する必要があるため。  
**方法**: dragStateに `mode` と `handle` を追加し、操作種別を明示的に管理。

- 対象ファイル: `src/main.ts`
- 追加した型/定数
  - `DragMode = "move" | "resize"`
  - `ResizeHandle = "nw" | "ne" | "sw" | "se"`
  - `handleSize`, `minViewportSize`

---

#### 9.3.2 リサイズハンドルの描画

**理由**: リサイズ可能な領域を視覚的に示す必要があるため。  
**方法**: 選択中の画像に対して四隅のハンドル矩形を描画。

- 実装箇所: `drawOverlay()`（`src/main.ts`）
- 処理内容
  - 選択枠を描画
  - `getHandleRects()` でハンドル位置計算
  - オレンジ塗り + 白枠で表示

---

#### 9.3.3 ハンドルのhitTest追加

**理由**: どのハンドルを掴んだかを識別する必要があるため。  
**方法**: ポインター座標と各ハンドル矩形の交差判定を追加。

- 実装関数: `hitTestHandle(rect, point)`
- ハンドル判定順: `nw`, `ne`, `sw`, `se`

---

#### 9.3.4 pointerdownの分岐処理

**理由**: 「ハンドル操作」か「画像移動」かを適切に判断するため。  
**方法**:
- 先に選択中の画像ハンドルを判定
- ハンドルヒットなら `mode="resize"`
- それ以外は既存の `mode="move"` 処理

---

#### 9.3.5 リサイズ計算ロジック

**理由**: ドラッグ方向に応じて正しい矩形更新を行う必要があるため。  
**方法**:
- `pointermove` 内で `handle` に応じた矩形更新
- `minViewportSize` を下限にして縮小しすぎを防止
- `Shift` 押下時はアスペクト比維持

**アスペクト維持処理**
- 初期の幅/高さ比を `startAspect` に保存
- 幅/高さのどちらを優先するかを差分で判定
- 必要に応じて `newX/newY` を補正してカーソル側を固定

---

### 9.4 変更ファイル（Phase4 追記分）

- 変更
  - `src/main.ts`

---

### 9.5 進捗トレース（Phase4 実装順）

1. リサイズ用の型/定数/dragState拡張
2. ハンドル描画の追加
3. ハンドルhitTestの追加
4. pointerdownでモード分岐
5. pointermoveでリサイズ演算
6. Shift押下でアスペクト維持

---

### 9.6 残タスクと次アクション（更新）

- Phase5: PDF書き出し（pdf-libによる画像埋め込み）

---

### 9.7 実行確認（未実施）

- `pnpm dev` によるローカル起動テストは未実施（Phase4 追加分も未検証）

---

## 10. 追記（Phase5 実装完了: PDF書き出し）

追記日: 2026-01-21

### 10.1 進捗更新サマリ

- Phase5（PDF書き出し）: **完了**

---

### 10.2 追加実装の目的と前提

**目的**: 画像配置結果を既存PDFに埋め込み、編集済みPDFとしてダウンロードできるようにする。  
**前提**: 画像の位置・サイズはPDF座標で保持されているため、pdf-libの座標系（左下原点）と一致する。  
**理由**: PLAN.mdの最終成果物（出力PDF）を完成させるため。

---

### 10.3 実装順序・理由・方法（トレース可能な詳細）

#### 10.3.1 書き出しユーティリティの新設

**理由**: PDF書き出し処理をUIロジックから分離し、再利用性を高めるため。  
**方法**: `src/export/toPdf.ts` を新規作成し、pdf-libでの埋め込み処理を集約。

- 実装内容
  - `exportPdfWithImages(pdfBytes, images)`
  - `PDFDocument.load` → `embedPng/embedJpg` → `page.drawImage` → `save()`

---

#### 10.3.2 PDF元データの保持方式変更

**理由**: 書き出し時に「元PDFのバイト列」が必要になるため。  
**方法**: 既存の `loadPdfFromFile` を `loadPdfFromData` に変更し、読み込み元の `Uint8Array` を保持。

- 対象ファイル: `src/pdf/loader.ts`
- 変更内容: ArrayBuffer入力で `PDFDocumentProxy` を返す

---

#### 10.3.3 画像データの保持拡張

**理由**: pdf-libで埋め込むためには、画像の生バイト列とMIME種別が必要。  
**方法**: 画像追加時に `bytes` と `mimeType` を `ImageObject` に格納。

- 対象ファイル: `src/main.ts`
- 追加項目
  - `bytes: Uint8Array`
  - `mimeType: string`

---

#### 10.3.4 Exportボタンとダウンロード処理

**理由**: ユーザーが明示的に書き出し操作できるUIが必要。  
**方法**:
- ツールバーに「Export PDF」ボタンを追加
- クリックで `exportPdfWithImages` を実行
- Blob生成 → `URL.createObjectURL` → `<a download>` で保存

**ファイル名ルール**
- 元ファイル名が `*.pdf` の場合: `-edited.pdf` を付与
- それ以外: `-edited.pdf` を追加

---

### 10.4 変更ファイル（Phase5 追記分）

- 追加
  - `src/export/toPdf.ts`
- 変更
  - `src/main.ts`
  - `src/pdf/loader.ts`

---

### 10.5 進捗トレース（Phase5 実装順）

1. `src/export/toPdf.ts` を追加し書き出し処理を実装
2. `loader.ts` を `loadPdfFromData` に変更
3. `main.ts` でPDFバイト列を保持
4. 画像追加時に `bytes` / `mimeType` を保存
5. Exportボタンとダウンロード処理を実装

---

### 10.6 残タスクと次アクション（更新）

- 全Phase完了（追加改善タスク: Undo/Redo, スナップ, レイヤ順など）

---

### 10.7 実行確認（未実施）

- `pnpm dev` によるローカル起動テストは未実施（Phase5 追加分も未検証）

---

## 11. 追記（画像リサイズ比率問題の解決）

追記日: 2026-01-21

### 11.1 解決内容サマリ

- 画像リサイズ時の比率保持問題: **解決（デフォルトで比率維持 / Altで自由変形）**

---

### 11.2 対応の目的と理由

**目的**: 画像リサイズ時に元の比率が崩れて歪む問題を解消する。  
**理由**: 画像編集として最も直感的な挙動は「比率維持」であり、歪みは編集品質の低下につながるため。

---

### 11.3 実装順序・理由・方法（トレース可能な詳細）

#### 11.3.1 リサイズ時の比率維持をデフォルト化

**理由**: これまでShift押下時のみ比率維持だったため、通常操作で歪みが発生していた。  
**方法**: `pointermove` 内のリサイズ処理で、比率維持をデフォルトに変更し、`Alt` 押下時のみ自由変形とした。

- 対象ファイル: `src/main.ts`
- 変更点
  - `keepAspect = !event.altKey` に変更
  - 幅/高さの更新後、アスペクト比に合わせて補正

---

#### 11.3.2 最小サイズ制約と基準点補正の継続

**理由**: 比率維持時でも縮小しすぎを防ぎ、ドラッグ中の基準点（掴んだ角）を保つ必要がある。  
**方法**: `minViewportSize` を下限として、必要に応じて `x/y` を補正。

- 対象ファイル: `src/main.ts`
- 変更点
  - 比率維持時の最小サイズ判定を追加
  - `newX/newY` をハンドル方向に合わせて補正

---

### 11.4 変更ファイル

- `src/main.ts`

---

### 11.5 進捗トレース（実装順）

1. 比率維持のデフォルト化（Altで解除）
2. 最小サイズ制約の適用継続
3. ハンドル基準点の補正ロジック更新

---

### 11.6 実行確認（報告ベース）

- 画像の比率問題は解決済み（報告: ユーザー確認済み）
