import puppeteer, { type Browser } from 'puppeteer';

import { pdfConfig } from '../../config/pdf.config.js';
import { AppError } from '../../core/errors/AppError.js';

export const pdfService = {
  async generateBufferFromHtml(html: string): Promise<Buffer> {
    let browser: Browser | null = null;

    try {
      browser = await puppeteer.launch({
        ...pdfConfig.browserLaunch,
        args: [...pdfConfig.browserLaunch.args],
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: pdfConfig.pageContentTimeoutMs });
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

      const pdfBuffer = await page.pdf(pdfConfig.pdfOptions);
      return Buffer.from(pdfBuffer);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      console.error('PDF Error:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close().catch(() => {
          void 0;
        });
      }
    }
  },
};
