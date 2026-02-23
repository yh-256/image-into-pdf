import "./style.css";
import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";
import { initPdfWorker } from "./pdf/worker";
import { loadPdfFromData } from "./pdf/loader";
import { renderPageToCanvas } from "./pdf/renderer";
import { exportPdfWithImages } from "./export/toPdf";

initPdfWorker();

type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ImageObject = {
  id: string;
  pageIndex: number;
  rect: PdfRect;
  src: string;
  bytes: Uint8Array;
  mimeType: string;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

app.innerHTML = `
  <div class="app">
    <header class="toolbar">
      <div class="toolbar__group">
        <label class="file">
          <input id="file-input" type="file" accept="application/pdf" />
          <span>Open PDF</span>
        </label>
        <label class="file file--ghost">
          <input id="image-input" type="file" accept="image/png,image/jpeg" />
          <span>Add Image</span>
        </label>
        <button id="export-pdf" type="button">Export PDF</button>
        <span id="file-name" class="muted">No file loaded</span>
      </div>
      <div class="toolbar__group">
        <button id="prev-page" type="button" aria-label="Previous page">Prev</button>
        <span id="page-indicator">- / -</span>
        <button id="next-page" type="button" aria-label="Next page">Next</button>
      </div>
      <div class="toolbar__group">
        <button id="zoom-out" type="button" aria-label="Zoom out">-</button>
        <span id="zoom-indicator">100%</span>
        <button id="zoom-in" type="button" aria-label="Zoom in">+</button>
      </div>
    </header>
    <main class="stage">
      <div class="canvas-wrap" id="canvas-wrap">
        <canvas id="pdf-canvas"></canvas>
        <canvas id="overlay-canvas"></canvas>
        <div id="empty-state" class="empty">Drop a PDF here or use Open PDF</div>
      </div>
    </main>
    <footer class="status-bar">
      <span id="status-text">Ready</span>
    </footer>
  </div>
`;

const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const imageInput = document.querySelector<HTMLInputElement>("#image-input")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export-pdf")!;
const fileName = document.querySelector<HTMLSpanElement>("#file-name")!;
const prevButton = document.querySelector<HTMLButtonElement>("#prev-page")!;
const nextButton = document.querySelector<HTMLButtonElement>("#next-page")!;
const pageIndicator =
  document.querySelector<HTMLSpanElement>("#page-indicator")!;
const zoomOutButton = document.querySelector<HTMLButtonElement>("#zoom-out")!;
const zoomInButton = document.querySelector<HTMLButtonElement>("#zoom-in")!;
const zoomIndicator =
  document.querySelector<HTMLSpanElement>("#zoom-indicator")!;
const pdfCanvas = document.querySelector<HTMLCanvasElement>("#pdf-canvas")!;
const overlayCanvas =
  document.querySelector<HTMLCanvasElement>("#overlay-canvas")!;
const emptyState = document.querySelector<HTMLDivElement>("#empty-state")!;
const statusText = document.querySelector<HTMLSpanElement>("#status-text")!;
const canvasWrap = document.querySelector<HTMLDivElement>("#canvas-wrap")!;

let pdfDoc: PDFDocumentProxy | null = null;
let currentViewport: PageViewport | null = null;
let currentPage = 1;
let scale = 1;
let renderToken = 0;
let pdfBytes: Uint8Array | null = null;
let loadedFileName = "document.pdf";
let selectedId: string | null = null;
const imageObjects: ImageObject[] = [];
const imageCache = new Map<string, HTMLImageElement>();
const handleSize = 10;
const minViewportSize = 24;

type DragMode = "move" | "resize";
type ResizeHandle = "nw" | "ne" | "sw" | "se";

let dragState: {
  id: string;
  mode: DragMode;
  handle?: ResizeHandle;
  startPointer: { x: number; y: number };
  startRect: PdfRect;
  startAspect: number;
} | null = null;

function setStatus(message: string) {
  statusText.textContent = message;
}

function setControlsEnabled(enabled: boolean) {
  prevButton.disabled = !enabled;
  nextButton.disabled = !enabled;
  zoomOutButton.disabled = !enabled;
  zoomInButton.disabled = !enabled;
  imageInput.disabled = !enabled;
  exportButton.disabled = !enabled || !pdfDoc;
}

function clampScale(nextScale: number) {
  return Math.min(4, Math.max(0.25, nextScale));
}

function updateIndicators() {
  if (!pdfDoc) {
    pageIndicator.textContent = "- / -";
  } else {
    pageIndicator.textContent = `${currentPage} / ${pdfDoc.numPages}`;
  }
  zoomIndicator.textContent = `${Math.round(scale * 100)}%`;
}

function getDownloadName() {
  if (!loadedFileName) {
    return "document-edited.pdf";
  }
  const lower = loadedFileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return `${loadedFileName.slice(0, -4)}-edited.pdf`;
  }
  return `${loadedFileName}-edited.pdf`;
}

function syncOverlayToPdfCanvas() {
  overlayCanvas.width = pdfCanvas.width;
  overlayCanvas.height = pdfCanvas.height;
  overlayCanvas.style.width = pdfCanvas.style.width;
  overlayCanvas.style.height = pdfCanvas.style.height;
}

function viewportRectToPdfRect(
  viewport: PageViewport,
  x: number,
  y: number,
  width: number,
  height: number,
): PdfRect {
  const [x1, y1] = viewport.convertToPdfPoint(x, y);
  const [x2, y2] = viewport.convertToPdfPoint(x + width, y + height);
  const left = Math.min(x1, x2);
  const bottom = Math.min(y1, y2);
  return {
    x: left,
    y: bottom,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function pdfRectToViewportRect(
  viewport: PageViewport,
  rect: PdfRect,
): { x: number; y: number; width: number; height: number } {
  const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y);
  const [x2, y2] = viewport.convertToViewportPoint(
    rect.x + rect.width,
    rect.y + rect.height,
  );
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return {
    x: left,
    y: top,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function getHandleRects(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const half = handleSize / 2;
  return {
    nw: { x: rect.x - half, y: rect.y - half },
    ne: { x: rect.x + rect.width - half, y: rect.y - half },
    sw: { x: rect.x - half, y: rect.y + rect.height - half },
    se: { x: rect.x + rect.width - half, y: rect.y + rect.height - half },
  };
}

function hitTestHandle(
  rect: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): ResizeHandle | null {
  const handles = getHandleRects(rect);
  for (const key of Object.keys(handles) as ResizeHandle[]) {
    const h = handles[key];
    const withinX = point.x >= h.x && point.x <= h.x + handleSize;
    const withinY = point.y >= h.y && point.y <= h.y + handleSize;
    if (withinX && withinY) {
      return key;
    }
  }
  return null;
}

function getOverlayContext() {
  const context = overlayCanvas.getContext("2d");
  if (!context) {
    throw new Error("Overlay canvas context not available");
  }
  return context;
}

function clearOverlay() {
  const context = getOverlayContext();
  const dpr = window.devicePixelRatio || 1;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(
    0,
    0,
    overlayCanvas.width / dpr,
    overlayCanvas.height / dpr,
  );
}

function drawOverlay() {
  if (!currentViewport) {
    return;
  }

  clearOverlay();
  const context = getOverlayContext();
  const dpr = window.devicePixelRatio || 1;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const objectsOnPage = imageObjects.filter(
    (obj) => obj.pageIndex === currentPage,
  );

  for (const obj of objectsOnPage) {
    const rect = pdfRectToViewportRect(currentViewport, obj.rect);
    const image = imageCache.get(obj.id);
    if (!image || !image.complete) {
      continue;
    }
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);

    if (obj.id === selectedId) {
      context.strokeStyle = "#ea6b2d";
      context.lineWidth = 2;
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);

      const handles = getHandleRects(rect);
      context.fillStyle = "#ea6b2d";
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      for (const key of Object.keys(handles) as ResizeHandle[]) {
        const h = handles[key];
        context.fillRect(h.x, h.y, handleSize, handleSize);
        context.strokeRect(h.x, h.y, handleSize, handleSize);
      }
    }
  }
}

async function renderCurrentPage() {
  if (!pdfDoc) {
    return;
  }

  const token = ++renderToken;
  setControlsEnabled(false);
  setStatus("Rendering page...");

  try {
    const result = await renderPageToCanvas(
      pdfDoc,
      currentPage,
      scale,
      pdfCanvas,
    );
    if (token !== renderToken) {
      return;
    }
    currentViewport = result.viewport;
    syncOverlayToPdfCanvas();
    emptyState.classList.add("is-hidden");
    drawOverlay();
    setStatus("Ready");
  } catch (error) {
    console.error(error);
    if (token !== renderToken) {
      return;
    }
    setStatus("Failed to render PDF");
  } finally {
    if (token === renderToken) {
      setControlsEnabled(true);
      updateIndicators();
    }
  }
}

async function handlePdfFile(file: File) {
  if (!file.type.includes("pdf")) {
    setStatus("Please choose a PDF file");
    return;
  }

  setControlsEnabled(false);
  setStatus("Loading PDF...");
  fileName.textContent = file.name;
  loadedFileName = file.name;

  try {
    const data = await file.arrayBuffer();
    pdfBytes = new Uint8Array(data.slice(0));
    pdfDoc = await loadPdfFromData(data);
    currentPage = 1;
    scale = 1;
    updateIndicators();
    await renderCurrentPage();
  } catch (error) {
    console.error(error);
    pdfDoc = null;
    currentViewport = null;
    pdfBytes = null;
    setStatus("Failed to load PDF");
  } finally {
    setControlsEnabled(true);
  }
}

async function handleImageFile(file: File) {
  if (!currentViewport) {
    setStatus("Load a PDF before adding images");
    return;
  }

  if (!file.type.includes("image")) {
    setStatus("Please choose a PNG or JPEG image");
    return;
  }

  const [src, bytes] = await Promise.all([
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }),
    file.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
  ]);

  const img = new Image();
  img.src = src;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image"));
  });

  const maxWidth = Math.min(320, currentViewport.width * 0.6);
  const targetWidth = Math.max(120, maxWidth);
  const targetHeight = (img.height / img.width) * targetWidth;
  const x = (currentViewport.width - targetWidth) / 2;
  const y = (currentViewport.height - targetHeight) / 2;

  const rect = viewportRectToPdfRect(
    currentViewport,
    x,
    y,
    targetWidth,
    targetHeight,
  );

  const obj: ImageObject = {
    id: crypto.randomUUID(),
    pageIndex: currentPage,
    rect,
    src,
    bytes,
    mimeType: file.type,
  };

  imageCache.set(obj.id, img);
  imageObjects.push(obj);
  selectedId = obj.id;
  drawOverlay();
  setStatus("Image added");
}

async function handleExportPdf() {
  if (!pdfBytes || !pdfDoc) {
    setStatus("Load a PDF before exporting");
    return;
  }

  setControlsEnabled(false);
  setStatus("Exporting PDF...");

  try {
    const output = await exportPdfWithImages(
      pdfBytes,
      imageObjects.map((obj) => ({
        id: obj.id,
        pageIndex: obj.pageIndex,
        rect: obj.rect,
        bytes: obj.bytes,
        mimeType: obj.mimeType,
      })),
    );

    const safeBytes = new Uint8Array(output);
    const blob = new Blob([safeBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getDownloadName();
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Export complete");
  } catch (error) {
    console.error(error);
    setStatus("Export failed");
  } finally {
    setControlsEnabled(true);
  }
}

function getPointerPosition(event: PointerEvent) {
  const bounds = overlayCanvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function hitTestImage(viewport: PageViewport, point: { x: number; y: number }) {
  for (let i = imageObjects.length - 1; i >= 0; i -= 1) {
    const obj = imageObjects[i];
    if (obj.pageIndex !== currentPage) {
      continue;
    }
    const rect = pdfRectToViewportRect(viewport, obj.rect);
    const withinX = point.x >= rect.x && point.x <= rect.x + rect.width;
    const withinY = point.y >= rect.y && point.y <= rect.y + rect.height;
    if (withinX && withinY) {
      return obj;
    }
  }
  return null;
}

function getSelectedObject() {
  if (!selectedId) {
    return null;
  }
  return imageObjects.find((obj) => obj.id === selectedId) || null;
}

fileInput.addEventListener("change", (event) => {
  const target = event.currentTarget as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    void handlePdfFile(file);
  }
  target.value = "";
});

imageInput.addEventListener("change", (event) => {
  const target = event.currentTarget as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    void handleImageFile(file);
  }
  target.value = "";
});

exportButton.addEventListener("click", () => {
  void handleExportPdf();
});

prevButton.addEventListener("click", () => {
  if (!pdfDoc || currentPage <= 1) {
    return;
  }
  currentPage -= 1;
  void renderCurrentPage();
});

nextButton.addEventListener("click", () => {
  if (!pdfDoc || currentPage >= pdfDoc.numPages) {
    return;
  }
  currentPage += 1;
  void renderCurrentPage();
});

zoomOutButton.addEventListener("click", () => {
  if (!pdfDoc) {
    return;
  }
  scale = clampScale(scale - 0.1);
  void renderCurrentPage();
});

zoomInButton.addEventListener("click", () => {
  if (!pdfDoc) {
    return;
  }
  scale = clampScale(scale + 0.1);
  void renderCurrentPage();
});

overlayCanvas.addEventListener("pointerdown", (event) => {
  if (!currentViewport) {
    return;
  }
  const point = getPointerPosition(event);
  const selectedObj = getSelectedObject();
  if (selectedObj && selectedObj.pageIndex === currentPage) {
    const selectedRect = pdfRectToViewportRect(
      currentViewport,
      selectedObj.rect,
    );
    const handle = hitTestHandle(selectedRect, point);
    if (handle) {
      dragState = {
        id: selectedObj.id,
        mode: "resize",
        handle,
        startPointer: point,
        startRect: { ...selectedObj.rect },
        startAspect:
          selectedRect.width === 0
            ? 1
            : selectedRect.width / selectedRect.height,
      };
      overlayCanvas.setPointerCapture(event.pointerId);
      drawOverlay();
      return;
    }
  }

  const hit = hitTestImage(currentViewport, point);
  if (!hit) {
    selectedId = null;
    drawOverlay();
    return;
  }

  selectedId = hit.id;
  dragState = {
    id: hit.id,
    mode: "move",
    startPointer: point,
    startRect: { ...hit.rect },
    startAspect: 1,
  };

  overlayCanvas.setPointerCapture(event.pointerId);
  drawOverlay();
});

overlayCanvas.addEventListener("pointermove", (event) => {
  if (!currentViewport || !dragState) {
    return;
  }

  const activeDrag = dragState;
  const point = getPointerPosition(event);
  const dx = point.x - activeDrag.startPointer.x;
  const dy = point.y - activeDrag.startPointer.y;

  const target = imageObjects.find((obj) => obj.id === activeDrag.id);
  if (!target) {
    return;
  }

  const startViewportRect = pdfRectToViewportRect(
    currentViewport,
    activeDrag.startRect,
  );

  if (activeDrag.mode === "move") {
    const movedRect = viewportRectToPdfRect(
      currentViewport,
      startViewportRect.x + dx,
      startViewportRect.y + dy,
      startViewportRect.width,
      startViewportRect.height,
    );
    target.rect = movedRect;
  } else if (activeDrag.mode === "resize" && activeDrag.handle) {
    let newX = startViewportRect.x;
    let newY = startViewportRect.y;
    let newWidth = startViewportRect.width;
    let newHeight = startViewportRect.height;

    if (activeDrag.handle.includes("n")) {
      newY = startViewportRect.y + dy;
      newHeight = startViewportRect.height - dy;
    }
    if (activeDrag.handle.includes("s")) {
      newHeight = startViewportRect.height + dy;
    }
    if (activeDrag.handle.includes("w")) {
      newX = startViewportRect.x + dx;
      newWidth = startViewportRect.width - dx;
    }
    if (activeDrag.handle.includes("e")) {
      newWidth = startViewportRect.width + dx;
    }

    const keepAspect = !event.altKey && activeDrag.startAspect > 0;
    if (keepAspect) {
      const aspect = activeDrag.startAspect;
      const widthFromHeight = newHeight * aspect;
      const heightFromWidth = newWidth / aspect;

      if (
        Math.abs(widthFromHeight - newWidth) <
        Math.abs(heightFromWidth - newHeight)
      ) {
        newWidth = widthFromHeight;
      } else {
        newHeight = heightFromWidth;
      }

      if (activeDrag.handle.includes("w")) {
        newX = startViewportRect.x + (startViewportRect.width - newWidth);
      }
      if (activeDrag.handle.includes("n")) {
        newY = startViewportRect.y + (startViewportRect.height - newHeight);
      }
    }

    if (keepAspect) {
      const aspect = activeDrag.startAspect;
      if (newWidth < minViewportSize) {
        newWidth = minViewportSize;
        newHeight = minViewportSize / aspect;
        if (activeDrag.handle.includes("w")) {
          newX = startViewportRect.x + (startViewportRect.width - newWidth);
        }
        if (activeDrag.handle.includes("n")) {
          newY = startViewportRect.y + (startViewportRect.height - newHeight);
        }
      }
      if (newHeight < minViewportSize) {
        newHeight = minViewportSize;
        newWidth = minViewportSize * aspect;
        if (activeDrag.handle.includes("w")) {
          newX = startViewportRect.x + (startViewportRect.width - newWidth);
        }
        if (activeDrag.handle.includes("n")) {
          newY = startViewportRect.y + (startViewportRect.height - newHeight);
        }
      }
    } else {
      newWidth = Math.max(minViewportSize, newWidth);
      newHeight = Math.max(minViewportSize, newHeight);
    }

    const resizedRect = viewportRectToPdfRect(
      currentViewport,
      newX,
      newY,
      newWidth,
      newHeight,
    );
    target.rect = resizedRect;
  }

  drawOverlay();
});

overlayCanvas.addEventListener("pointerup", (event) => {
  if (!dragState) {
    return;
  }
  overlayCanvas.releasePointerCapture(event.pointerId);
  dragState = null;
});

overlayCanvas.addEventListener("pointerleave", () => {
  if (!dragState) {
    return;
  }
  dragState = null;
});

canvasWrap.addEventListener("dragover", (event) => {
  event.preventDefault();
  canvasWrap.classList.add("is-dragging");
});

canvasWrap.addEventListener("dragleave", () => {
  canvasWrap.classList.remove("is-dragging");
});

canvasWrap.addEventListener("drop", (event) => {
  event.preventDefault();
  canvasWrap.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    void handlePdfFile(file);
  }
});

setControlsEnabled(false);
updateIndicators();
