import { describe, expect, it } from 'vitest';
import { buildQuotationEmailContent, escapeHtml } from '../src/modules/quotation-email/quotation-email-template';
import { validateSendQuotationEmailInput } from '../src/modules/quotation-email/quotation-email.validation';

describe('Quotation Email Validation and Security Rules', () => {
  it('validates correct email payload', () => {
    const validPayload = {
      generatedDocumentId: 1,
      to: ['customer@example.com'],
      cc: ['manager@example.com'],
      bcc: [],
      subject: 'Quotation BUMINEX/2026-27/000001',
      message: 'Please find quotation attached.',
      attachmentIds: [1, 2],
    };

    const validated = validateSendQuotationEmailInput(validPayload);
    expect(validated.to).toEqual(['customer@example.com']);
    expect(validated.cc).toEqual(['manager@example.com']);
    expect(validated.subject).toBe('Quotation BUMINEX/2026-27/000001');
  });

  it('rejects invalid recipient email formats', () => {
    const invalidPayload = {
      generatedDocumentId: 1,
      to: ['not-an-email'],
      subject: 'Subject',
      message: 'Message',
    };

    expect(() => validateSendQuotationEmailInput(invalidPayload)).toThrow(/Invalid/i);
  });

  it('rejects newline and carriage return injection in subject header', () => {
    const maliciousPayload = {
      generatedDocumentId: 1,
      to: ['customer@example.com'],
      subject: 'Quotation BUMINEX/2026-27/000001\r\nBcc: evil@hacker.com',
      message: 'Message',
    };

    expect(() => validateSendQuotationEmailInput(maliciousPayload)).toThrow(/Subject cannot contain/i);
  });

  it('rejects payloads exceeding recipient limits', () => {
    const manyEmails = Array.from({ length: 22 }, (_, i) => `user${i}@example.com`);
    const payload = {
      generatedDocumentId: 1,
      to: manyEmails.slice(0, 10),
      cc: manyEmails.slice(10, 20),
      bcc: manyEmails.slice(20),
      subject: 'Subject',
      message: 'Message',
    };

    expect(() => validateSendQuotationEmailInput(payload)).toThrow(/Total unique email recipients/i);
  });

  it('escapes user message in HTML email template', () => {
    const unescapedMessage = 'Hello <script>alert("xss")</script>\nSpecial & Co.';
    const content = buildQuotationEmailContent({
      quotationNumber: 'BUMINEX/2026-27/000001',
      businessName: 'Buminex Pharmtech & Co',
      messageText: unescapedMessage,
    });

    expect(content.html).not.toContain('<script>');
    expect(content.html).toContain('&lt;script&gt;');
    expect(content.html).toContain('Buminex Pharmtech &amp; Co');
    expect(content.text).toContain('Hello <script>alert("xss")</script>');
  });

  it('escapes HTML special characters correctly', () => {
    expect(escapeHtml('<div id="test">\'hello\' & "world"</div>')).toBe(
      '&lt;div id=&quot;test&quot;&gt;&#039;hello&#039; &amp; &quot;world&quot;&lt;/div&gt;',
    );
  });
});
