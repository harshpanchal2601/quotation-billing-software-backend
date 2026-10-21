import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { firmPublicAssetDirectory, storageConfig } from '../src/config/storage.config';
import { getBrandingFileDataUrl } from '../src/modules/quotations/documents/quotation-documents.repository';
import {
  escapeHtml,
  formatCurrencyPdf,
  renderQuotationHtmlTemplate,
} from '../src/modules/quotations/documents/quotation-document.template';
import type { QuotationPdfViewModel } from '../src/modules/quotations/documents/quotation-documents.types';

describe('quotation PDF template and document security', () => {
  const mockViewModel: QuotationPdfViewModel = {
    quotationNumber: 'BUMINEX/2026-27/000001',
    revisionNumber: 0,
    quotationDate: '2026-04-15T00:00:00.000Z',
    validUntil: '2026-05-15T00:00:00.000Z',
    status: 'DRAFT',
    currency: 'USD',
    taxMode: 'CGST_SGST',
    companyNameSnapshot: 'Acme <script>alert("xss")</script> Corp',
    companyGstinSnapshot: '24AAAAA0000A1Z5',
    companyPanSnapshot: 'AAAAA0000A',
    contactNameSnapshot: 'John & Jane',
    contactEmailSnapshot: 'john@acme.com',
    contactPhoneSnapshot: '9876543210',
    billingAddressSnapshot: { addressLine1: '123 Main St', city: 'Mumbai', state: 'MH', postalCode: '400001' },
    shippingAddressSnapshot: null,
    subtotal: '1000.00',
    itemDiscountAmount: '0.00',
    quotationDiscountType: 'NONE',
    quotationDiscountValue: '0.00',
    quotationDiscountAmount: '0.00',
    taxableAmount: '1000.00',
    cgstAmount: '90.00',
    sgstAmount: '90.00',
    igstAmount: '0.00',
    freightAmount: '0.00',
    otherCharges: '0.00',
    roundOffAmount: '0.00',
    grandTotal: '1180.00',
    amountInWords: 'One Thousand One Hundred Eighty Dollars Only',
    deliveryTerms: 'Standard delivery',
    dispatchTerms: null,
    paymentTerms: null,
    taxTerms: null,
    freightTerms: null,
    warrantyTerms: null,
    remarks: 'Customer special instructions',
    termsAndConditions: 'Terms line 1\nTerms line 2',
    items: [
      {
        lineNumber: 1,
        itemCodeSnapshot: 'ITEM-001',
        itemNameSnapshot: 'React Tank <b style="color:red">bold</b>',
        descriptionSnapshot: 'Specification notes',
        measurementUnitSnapshot: 'PCS',
        quantity: '2.000',
        unitRate: '500.00',
        discountType: 'NONE',
        discountValue: '0.00',
        discountAmount: '0.00',
        taxableAmount: '1000.00',
        gstRate: '18.00',
        taxAmount: '180.00',
        lineTotal: '1180.00',
      },
    ],
    businessProfile: {
      legalName: 'Buminex Pharmtech Solutions Pvt Ltd',
      displayName: 'Buminex Pharmtech',
      gstin: '27AAAAA0000A1Z5',
      pan: 'AAAAA0000B',
      cin: 'U12345MH2026PTC000000',
      addressLine1: 'Plot 45, MIDC',
      addressLine2: null,
      city: 'Thane',
      state: 'Maharashtra',
      postalCode: '400604',
      country: 'India',
      primaryPhone: '022-12345678',
      primaryEmail: 'info@buminex.com',
      website: 'www.buminex.com',
      logoDataUrl: null,
      signatureDataUrl: null,
      stampDataUrl: null,
      primaryColour: '#168A56',
      secondaryColour: '#082B67',
    },
    bankDetail: {
      bankName: 'HDFC Bank',
      accountName: 'Buminex Pharmtech',
      accountNumber: '50200012345678',
      ifscCode: 'HDFC0000123',
      branchName: 'Thane West',
      swiftCode: null,
    },
  };

  it('escapes HTML tags to prevent XSS injection in PDF template', () => {
    const html = renderQuotationHtmlTemplate(mockViewModel);

    expect(html).toContain('Acme &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; Corp');
    expect(html).toContain('React Tank &lt;b style=&quot;color:red&quot;&gt;bold&lt;/b&gt;');
    expect(html).not.toContain('<script>alert("xss")</script>');
  });

  it('strictly excludes confidential internal notes from generated customer PDF HTML', () => {
    const viewModelWithNotes = {
      ...mockViewModel,
      internalNotes: 'CONFIDENTIAL: Internal margin is 35%. Do not share.',
    };

    const html = renderQuotationHtmlTemplate(viewModelWithNotes);

    expect(html).not.toContain('CONFIDENTIAL');
    expect(html).not.toContain('Internal margin is 35%');
  });

  it('formats currency using the saved quotation currency code without forcing INR', () => {
    const formattedUsd = formatCurrencyPdf('1180.00', 'USD');
    const formattedEur = formatCurrencyPdf('500.00', 'EUR');

    expect(formattedUsd).toBe('USD 1180.00');
    expect(formattedEur).toBe('EUR 500.00');

    const html = renderQuotationHtmlTemplate(mockViewModel);
    expect(html).toContain('USD 1180.00');
  });

  it('escapes special character ampersands in contact names and bank details', () => {
    const escapedName = escapeHtml('John & Jane');
    expect(escapedName).toBe('John &amp; Jane');
  });

  it('renders the saved quotation revision number separately from generated document versions', () => {
    const html = renderQuotationHtmlTemplate({
      ...mockViewModel,
      revisionNumber: 2,
    });

    expect(html).toContain('Revision:</strong> #2');
  });

  it('renders a dedicated signatory block with company sign-off and label', () => {
    const html = renderQuotationHtmlTemplate(mockViewModel);

    expect(html).toContain('class="signatory-block"');
    expect(html).toContain('For Buminex Pharmtech');
    expect(html).toContain('class="signatory-label">Authorised Signatory</span>');
    expect(html).toContain('This is a computer-generated quotation document.');
  });

  it('renders signature and stamp in separate safe containers when both assets exist', () => {
    const html = renderQuotationHtmlTemplate({
      ...mockViewModel,
      businessProfile: {
        ...mockViewModel.businessProfile!,
        signatureDataUrl: 'data:image/png;base64,signature-data',
        stampDataUrl: 'data:image/png;base64,stamp-data',
      },
    });

    expect(html).toContain('class="stamp-frame"');
    expect(html).toContain('class="stamp-image" alt="Company stamp"');
    expect(html).toContain('class="signature-frame"');
    expect(html).toContain('class="signature-image" alt="Authorised signature"');
    expect(html).toContain('object-fit: contain');
  });

  it('uses bounded dimensions for the authorised signature image', () => {
    const html = renderQuotationHtmlTemplate(mockViewModel);

    expect(html).toContain('max-width: 150px;');
    expect(html).toContain('max-height: 68px;');
    expect(html).toContain('.signature-image');
  });

  it('uses bounded dimensions for the company stamp image', () => {
    const html = renderQuotationHtmlTemplate(mockViewModel);

    expect(html).toContain('max-width: 92px;');
    expect(html).toContain('max-height: 92px;');
    expect(html).toContain('.stamp-image');
  });

  it('does not render an empty stamp placeholder when only signature exists', () => {
    const html = renderQuotationHtmlTemplate({
      ...mockViewModel,
      businessProfile: {
        ...mockViewModel.businessProfile!,
        signatureDataUrl: 'data:image/png;base64,signature-data',
        stampDataUrl: null,
      },
    });

    expect(html).toContain('class="signature-frame"');
    expect(html).not.toContain('class="stamp-frame"');
    expect(html).not.toContain('alt="Company stamp"');
  });

  it('does not render a broken signature placeholder when only stamp exists', () => {
    const html = renderQuotationHtmlTemplate({
      ...mockViewModel,
      businessProfile: {
        ...mockViewModel.businessProfile!,
        signatureDataUrl: null,
        stampDataUrl: 'data:image/png;base64,stamp-data',
      },
    });

    expect(html).toContain('class="stamp-frame"');
    expect(html).not.toContain('class="signature-frame"');
    expect(html).not.toContain('alt="Authorised signature"');
  });

  it('keeps the signatory section usable when neither signature nor stamp exists', () => {
    const html = renderQuotationHtmlTemplate({
      ...mockViewModel,
      businessProfile: {
        ...mockViewModel.businessProfile!,
        signatureDataUrl: null,
        stampDataUrl: null,
      },
    });

    expect(html).toContain('class="signatory-block"');
    expect(html).toContain('Authorised Signatory');
    expect(html).not.toContain('class="signatory-assets"');
    expect(html).not.toContain('<img src=""');
  });

  it('applies page-break protection to terms and signatory sections', () => {
    const html = renderQuotationHtmlTemplate(mockViewModel);

    expect(html).toContain('.terms-grid');
    expect(html).toContain('page-break-inside: avoid');
    expect(html).toContain('break-inside: avoid');
    expect(html).toContain('.document-footer');
  });

  it('keeps the quotation revision visible in the PDF HTML alongside signatory layout changes', () => {
    const html = renderQuotationHtmlTemplate({
      ...mockViewModel,
      revisionNumber: 1,
      businessProfile: {
        ...mockViewModel.businessProfile!,
        signatureDataUrl: 'data:image/png;base64,signature-data',
        stampDataUrl: 'data:image/png;base64,stamp-data',
      },
    });

    expect(html).toContain('Revision:</strong> #1');
    expect(html).toContain('class="signatory-block"');
  });

  it('resolves branding data URLs only from the matching asset storage area', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const filename = `signature-test-${Date.now()}.png`;
    const relativePath = path.join('signatures', filename);
    await fs.mkdir(path.join(storageConfig.root, 'signatures'), { recursive: true });
    await fs.writeFile(path.join(storageConfig.root, relativePath), Buffer.from('signature-fixture'));

    try {
      const signatureDataUrl = await getBrandingFileDataUrl(7, 'signature', relativePath);
      const stampDataUrl = await getBrandingFileDataUrl(7, 'stamp', relativePath);

      expect(signatureDataUrl).toBe(`data:image/png;base64,${Buffer.from('signature-fixture').toString('base64')}`);
      expect(stampDataUrl).toBeNull();
    } finally {
      await fs.unlink(path.join(storageConfig.root, relativePath)).catch(() => {});
      warnSpy.mockRestore();
    }
  });

  it('loads firm-scoped branding and rejects another firm asset path', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const filename = `logo-test-${Date.now()}.png`;
    const firmDirectory = firmPublicAssetDirectory(7, 'logos');
    const relativePath = path.join(firmDirectory, filename);
    await fs.mkdir(path.join(storageConfig.root, firmDirectory), { recursive: true });
    await fs.writeFile(path.join(storageConfig.root, relativePath), Buffer.from('logo-fixture'));

    try {
      const logoDataUrl = await getBrandingFileDataUrl(7, 'logo', relativePath);
      const crossFirmLogo = await getBrandingFileDataUrl(8, 'logo', relativePath);

      expect(logoDataUrl).toBe(`data:image/png;base64,${Buffer.from('logo-fixture').toString('base64')}`);
      expect(crossFirmLogo).toBeNull();
    } finally {
      await fs.unlink(path.join(storageConfig.root, relativePath)).catch(() => {});
      warnSpy.mockRestore();
    }
  });

  it('returns null for missing optional branding files without exposing storage paths', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const missingSignature = await getBrandingFileDataUrl(7, 'signature', 'signatures/missing-signature.png');
      const unsafeSignature = await getBrandingFileDataUrl(7, 'signature', '../outside-storage.png');
      const disguisedTraversal = await getBrandingFileDataUrl(7, 'signature', 'signatures/../outside-storage.png');

      expect(missingSignature).toBeNull();
      expect(unsafeSignature).toBeNull();
      expect(disguisedTraversal).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
