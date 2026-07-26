import { CommunicationStatus, CommunicationType, QuotationStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildQuotationEmailContent, escapeHtml } from '../src/modules/quotation-email/quotation-email-template';
import { validateSendQuotationEmailInput } from '../src/modules/quotation-email/quotation-email.validation';

const mocks = vi.hoisted(() => {
  const prisma = {
    quotation: { findFirst: vi.fn(), update: vi.fn() },
    generatedDocument: { findFirst: vi.fn() },
    quotationAttachment: { findMany: vi.fn() },
    businessProfile: { findFirst: vi.fn() },
    quotationCommunication: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    quotationStatusHistory: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };

  return {
    prisma,
    sendMail: vi.fn(),
    stat: vi.fn(),
  };
});

vi.mock('../src/config/database.js', () => ({
  prisma: mocks.prisma,
}));

vi.mock('../src/modules/quotation-email/mail-transport.service.js', () => ({
  getMailTransporter: () => ({ sendMail: mocks.sendMail }),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    stat: mocks.stat,
  },
  stat: mocks.stat,
}));

import {
  getQuotationCommunicationHistoryService,
  sendQuotationEmailService,
} from '../src/modules/quotation-email/quotation-email.service';

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

describe('quotation email communication lifecycle', () => {
  const now = new Date('2026-07-26T10:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback === 'function') return callback(mocks.prisma);
      return undefined;
    });
    mocks.prisma.quotation.findFirst.mockResolvedValue({
      id: 1,
      quotationNumber: 'BUMINEX/2026-27/000001',
      revisionNumber: 0,
      status: QuotationStatus.DRAFT,
      isLatestRevision: true,
    });
    mocks.prisma.generatedDocument.findFirst.mockResolvedValue({
      id: 10,
      quotationId: 1,
      versionNumber: 2,
      documentType: 'QUOTATION_PDF',
      filePath: 'quotation-documents/quote.pdf',
      generatedAt: now,
      generatedBy: { id: 1, name: 'Admin User' },
    });
    mocks.prisma.quotationAttachment.findMany.mockResolvedValue([]);
    mocks.prisma.businessProfile.findFirst.mockResolvedValue({
      displayName: 'Buminex Pharmtech',
      primaryEmail: 'sales@buminex.test',
    });
    mocks.prisma.quotationCommunication.count.mockResolvedValue(0);
    mocks.prisma.quotationCommunication.create.mockResolvedValue({ id: 100 });
    mocks.prisma.quotationCommunication.update.mockResolvedValue({ id: 100 });
    mocks.prisma.quotation.update.mockResolvedValue({ id: 1, status: QuotationStatus.SENT });
    mocks.prisma.quotationStatusHistory.create.mockResolvedValue({ id: 1 });
    mocks.prisma.auditLog.create.mockResolvedValue({ id: 1 });
    mocks.stat.mockResolvedValue({ size: 1024 });
    mocks.sendMail.mockResolvedValue({ messageId: 'smtp-message-123' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records an accepted communication and transitions latest Draft quotation to Sent after SMTP acceptance', async () => {
    const result = await sendQuotationEmailService(
      1,
      {
        generatedDocumentId: 10,
        to: ['customer@example.com', 'customer@example.com'],
        cc: ['customer@example.com', 'manager@example.com'],
        bcc: ['audit@example.com'],
        subject: 'Quotation BUMINEX/2026-27/000001',
        message: 'Please find the quotation attached.',
      },
      1,
      { userId: 1 },
    );

    expect(mocks.prisma.quotationCommunication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quotationId: 1,
        generatedDocumentId: 10,
        senderUserId: 1,
        status: CommunicationStatus.PENDING,
        communicationType: CommunicationType.QUOTATION_EMAIL,
        toRecipients: ['customer@example.com'],
        ccRecipients: ['manager@example.com'],
        bccRecipients: ['audit@example.com'],
        documentSnapshot: expect.objectContaining({
          versionNumber: 2,
          quotationRevisionNumber: 0,
          displayFilename: 'Quotation-BUMINEX-2026-27-000001.pdf',
        }),
      }),
    });
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'customer@example.com',
      cc: 'manager@example.com',
      bcc: 'audit@example.com',
    }));
    expect(mocks.prisma.quotationCommunication.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: expect.objectContaining({
        status: CommunicationStatus.ACCEPTED,
        providerMessageId: 'smtp-message-123',
      }),
    });
    expect(mocks.prisma.quotation.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ status: QuotationStatus.SENT, updatedById: 1 }),
    });
    expect(mocks.prisma.quotationStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quotationId: 1,
        fromStatus: QuotationStatus.DRAFT,
        toStatus: QuotationStatus.SENT,
        changedById: 1,
        comment: 'Quotation emailed. Communication attempt #100.',
      }),
    });
    expect(result).toMatchObject({
      communicationId: 100,
      status: CommunicationStatus.ACCEPTED,
      quotationStatusAfter: QuotationStatus.SENT,
      statusTransitioned: true,
    });
  });

  it('records failed SMTP attempts without changing quotation status', async () => {
    mocks.sendMail.mockRejectedValueOnce(Object.assign(new Error('Auth failed'), { code: 'EAUTH' }));

    await expect(
      sendQuotationEmailService(
        1,
        {
          generatedDocumentId: 10,
          to: ['customer@example.com'],
          subject: 'Quotation',
          message: 'Please find attached.',
        },
        1,
        { userId: 1 },
      ),
    ).rejects.toMatchObject({
      statusCode: 502,
      message: 'Failed to send quotation email. Please check SMTP settings or recipient addresses.',
    });

    expect(mocks.prisma.quotationCommunication.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: expect.objectContaining({
        status: CommunicationStatus.FAILED,
        failureCategory: 'EAUTH',
      }),
    });
    expect(mocks.prisma.quotation.update).not.toHaveBeenCalled();
    expect(mocks.prisma.quotationStatusHistory.create).not.toHaveBeenCalled();
  });

  it('returns communication history for the exact quotation revision', async () => {
    mocks.prisma.quotation.findFirst.mockResolvedValueOnce({ id: 1 });
    mocks.prisma.quotationCommunication.count.mockResolvedValueOnce(1);
    mocks.prisma.quotationCommunication.findMany.mockResolvedValueOnce([
      {
        id: 100,
        quotationId: 1,
        generatedDocumentId: 10,
        communicationType: CommunicationType.QUOTATION_EMAIL,
        status: CommunicationStatus.ACCEPTED,
        attemptNumber: 1,
        toRecipients: ['customer@example.com'],
        ccRecipients: ['manager@example.com'],
        bccRecipients: ['audit@example.com'],
        subjectSnapshot: 'Quotation',
        messageSnapshot: 'Please find attached.',
        documentSnapshot: { displayFilename: 'Quotation-BUMINEX.pdf', quotationRevisionNumber: 0 },
        attachmentSnapshots: [{ id: 5, originalFilename: 'drawing.pdf' }],
        providerMessageId: 'smtp-message-123',
        failureCategory: null,
        failureSummary: null,
        createdAt: now,
        acceptedAt: now,
        failedAt: null,
        sender: { id: 1, name: 'Admin User', email: 'admin@example.com' },
        generatedDocument: { id: 10, versionNumber: 2, generatedAt: now },
      },
    ]);

    const result = await getQuotationCommunicationHistoryService(1, {});

    expect(result.communications).toEqual([
      expect.objectContaining({
        id: 100,
        quotationRevisionNumber: 0,
        to: ['customer@example.com'],
        cc: ['manager@example.com'],
        bcc: ['audit@example.com'],
        subject: 'Quotation',
        status: CommunicationStatus.ACCEPTED,
      }),
    ]);
  });
});
