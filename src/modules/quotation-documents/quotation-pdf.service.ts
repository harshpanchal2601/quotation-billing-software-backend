import puppeteer, { type Browser } from 'puppeteer';

export async function generatePdfBufferFromHtml(html: string): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(async () => {
      const images = Array.from((globalThis as unknown as { document: { images: Iterable<unknown> } }).document.images);
      await Promise.all(
        images.map((image) => {
          const pdfImage = image as {
            complete: boolean;
            addEventListener: (event: 'load' | 'error', callback: () => void, options: { once: boolean }) => void;
          };
          if (pdfImage.complete) return Promise.resolve();

          return new Promise<void>((resolve) => {
            pdfImage.addEventListener('load', () => resolve(), { once: true });
            pdfImage.addEventListener('error', () => resolve(), { once: true });
          });
        }),
      );
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm',
      },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        /* ignore close errors */
      });
    }
  }
}
