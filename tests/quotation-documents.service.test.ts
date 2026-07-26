import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  formatCurrencyPdf,
  renderQuotationHtmlTemplate,
} from '../src/modules/quotation-documents/quotation-pdf-template';
import type { QuotationPdfViewModel } from '../src/modules/quotation-documents/quotation-documents.types';

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
});
