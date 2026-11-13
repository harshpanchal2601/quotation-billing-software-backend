export const pdfConfig = {
  browserLaunch: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
  pageContentTimeoutMs: 30_000,
  pdfOptions: {
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;padding:0 15mm;text-align:right;font:9px Arial,sans-serif;color:#526077">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: {
      top: '15mm',
      right: '15mm',
      bottom: '15mm',
      left: '15mm',
    },
  },
} as const;
