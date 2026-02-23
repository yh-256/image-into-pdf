import { PDFDocument } from "pdf-lib";

export async function exportPdfWithImages(
  pdfBytes: Uint8Array,
  images: Array<{
    id: string;
    pageIndex: number;
    rect: { x: number; y: number; width: number; height: number };
    bytes: Uint8Array;
    mimeType: string;
  }>,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();

  for (const image of images) {
    const page = pages[image.pageIndex - 1];
    if (!page) {
      continue;
    }

    const isPng = image.mimeType.includes("png");
    const embedded = isPng
      ? await pdfDoc.embedPng(image.bytes)
      : await pdfDoc.embedJpg(image.bytes);

    page.drawImage(embedded, {
      x: image.rect.x,
      y: image.rect.y,
      width: image.rect.width,
      height: image.rect.height,
    });
  }

  return pdfDoc.save();
}
