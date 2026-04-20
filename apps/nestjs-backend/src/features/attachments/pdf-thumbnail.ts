import { PDFParse } from 'pdf-parse';

export async function renderPdfFirstPageAsImage(
  pdfData: Buffer | Uint8Array,
  scale = 2.0
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const parser = new PDFParse({
    data: Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData),
  });

  try {
    const result = await parser.getScreenshot({
      partial: [1],
      imageBuffer: true,
      imageDataUrl: false,
      scale,
    });
    const page = result.pages[0];

    if (!page?.data) {
      throw new Error('PDFParse did not return screenshot data for page 1');
    }

    return {
      buffer: Buffer.from(page.data),
      width: page.width ?? 0,
      height: page.height ?? 0,
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
