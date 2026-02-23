import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

export async function loadPdfFromData(
  data: ArrayBuffer,
): Promise<PDFDocumentProxy> {
  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: "/cmaps/",
    cMapPacked: true,
  });
  return loadingTask.promise;
}
