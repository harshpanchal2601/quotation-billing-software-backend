export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildQuotationEmailContent(input: {
  quotationNumber: string;
  businessName: string;
  messageText: string;
}): { text: string; html: string } {
  const safeBusinessName = escapeHtml(input.businessName);
  const safeQuotationNumber = escapeHtml(input.quotationNumber);

  // Escaped plain text lines to HTML paragraphs/breaks
  const formattedHtmlMessage = input.messageText
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br/>');

  const text = `${input.messageText}

---
Quotation Reference: ${input.quotationNumber}
Sent via ${input.businessName} Quotation System`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333333; margin: 0; padding: 20px; background-color: #f9fafb; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e5e7eb; }
    .header { border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }
    .header h2 { margin: 0; color: #1e3a8a; font-size: 20px; }
    .content { font-size: 15px; margin-bottom: 24px; white-space: pre-wrap; }
    .footer { border-top: 1px solid #e5e7eb; pt: 16px; margin-top: 24px; font-size: 12px; color: #6b7280; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${safeBusinessName}</h2>
    </div>
    <div class="content">
      ${formattedHtmlMessage}
    </div>
    <div class="footer">
      <p>Quotation Reference: <strong>${safeQuotationNumber}</strong></p>
      <p>This message and attached documents were sent from ${safeBusinessName}.</p>
    </div>
  </div>
</body>
</html>`;

  return { text, html };
}
