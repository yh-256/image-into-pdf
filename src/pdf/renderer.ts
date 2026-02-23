import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";

export async function renderPageToCanvas(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<{
  page: PDFPageProxy;
  viewportWidth: number;
  viewportHeight: number;
  viewport: PageViewport;
}> {
  const page = await pdf.getPage(pageNumber);
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * dpr });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context not available");
  }

  const renderTask = page.render({
    canvasContext: context,
    viewport,
    canvas,
  });

  await renderTask.promise;

  return {
    page,
    viewportWidth: viewport.width / dpr,
    viewportHeight: viewport.height / dpr,
    viewport: page.getViewport({ scale }),
  };
}
