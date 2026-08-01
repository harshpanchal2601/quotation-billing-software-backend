import type { QuotationPdfViewModel } from './quotation-documents.types.js';

export function escapeHtml(str: string | null | undefined): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatCurrencyPdf(val: string | number, currency: string = 'INR'): string {
  const num = Number(val);
  if (!Number.isFinite(num)) return `${currency} 0.00`;
  return `${currency} ${num.toFixed(2)}`;
}

export function renderQuotationHtmlTemplate(data: QuotationPdfViewModel): string {
  const bp = data.businessProfile;
  const bank = data.bankDetail;
  const currency = escapeHtml(data.currency || 'INR');

  const primaryColor = bp?.primaryColour || '#168A56';
  const secondaryColor = bp?.secondaryColour || '#082B67';
  const signatoryAssetsHtml =
    bp?.stampDataUrl || bp?.signatureDataUrl
      ? `<div class="signatory-assets">
          ${
            bp.stampDataUrl
              ? `<div class="stamp-frame">
                  <img src="${bp.stampDataUrl}" class="stamp-image" alt="Company stamp">
                </div>`
              : ''
          }
          ${
            bp.signatureDataUrl
              ? `<div class="signature-frame">
                  <img src="${bp.signatureDataUrl}" class="signature-image" alt="Authorised signature">
                </div>`
              : ''
          }
        </div>`
      : '';

  // Build items HTML rows
  const itemsHtml = data.items
    .map(
      (item: QuotationPdfViewModel['items'][number]) => `
      <tr>
        <td style="text-align: center;">${item.lineNumber}</td>
        <td>
          <strong>${escapeHtml(item.itemNameSnapshot)}</strong>
          ${item.itemCodeSnapshot ? `<br><small style="color: #666;">Code: ${escapeHtml(item.itemCodeSnapshot)}</small>` : ''}
          ${item.descriptionSnapshot ? `<br><small style="color: #444; white-space: pre-line;">${escapeHtml(item.descriptionSnapshot)}</small>` : ''}
        </td>
        <td style="text-align: right;">${escapeHtml(item.quantity)} ${escapeHtml(item.measurementUnitSnapshot)}</td>
        <td style="text-align: right;">${formatCurrencyPdf(item.unitRate, currency)}</td>
        <td style="text-align: right;">${formatCurrencyPdf(item.discountAmount, currency)}</td>
        <td style="text-align: right;">${formatCurrencyPdf(item.taxableAmount, currency)}</td>
        <td style="text-align: right;">${escapeHtml(item.gstRate)}%</td>
        <td style="text-align: right; font-weight: bold;">${formatCurrencyPdf(item.lineTotal, currency)}</td>
      </tr>
    `,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Quotation ${escapeHtml(data.quotationNumber)}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm;
    }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      color: #333;
      font-size: 12px;
      line-height: 1.4;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
    }
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 10px;
    }
    .header-table td {
      vertical-align: top;
    }
    .company-title {
      font-size: 20px;
      font-weight: bold;
      color: ${primaryColor};
      margin: 0 0 4px 0;
    }
    .company-details {
      font-size: 11px;
      color: #555;
    }
    .quote-title-box {
      text-align: right;
    }
    .quote-title {
      font-size: 24px;
      font-weight: bold;
      color: ${secondaryColor};
      text-transform: uppercase;
      margin: 0 0 5px 0;
    }
    .info-grid {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .info-grid td {
      width: 50%;
      vertical-align: top;
      padding: 10px;
      border: 1px solid #e0e0e0;
      background-color: #fafafa;
    }
    .section-heading {
      font-size: 12px;
      font-weight: bold;
      color: ${secondaryColor};
      text-transform: uppercase;
      margin-bottom: 6px;
      border-bottom: 1px solid #ccc;
      padding-bottom: 3px;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .items-table th {
      background-color: ${primaryColor};
      color: #ffffff;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      padding: 8px 6px;
      border: 1px solid ${primaryColor};
    }
    .items-table td {
      padding: 8px 6px;
      border: 1px solid #e0e0e0;
      font-size: 11px;
    }
    .items-table tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    .totals-table {
      width: 45%;
      margin-left: auto;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .totals-table td {
      padding: 5px 8px;
      font-size: 11px;
    }
    .totals-table tr.grand-total {
      background-color: ${primaryColor};
      color: #ffffff;
      font-weight: bold;
      font-size: 13px;
    }
    .totals-table tr.grand-total td {
      padding: 8px;
    }
    .words-box {
      background-color: #f4f6f8;
      border-left: 3px solid ${primaryColor};
      padding: 8px 12px;
      margin-bottom: 20px;
      font-size: 11px;
      font-style: italic;
    }
    .terms-grid {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .terms-grid td {
      width: 50%;
      vertical-align: top;
      padding: 10px;
      border: 1px solid #e0e0e0;
    }
    .document-footer {
      width: 100%;
      border-collapse: collapse;
      margin-top: 18px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .document-footer td {
      width: 50%;
      vertical-align: bottom;
    }
    .computer-note {
      font-size: 10px;
      color: #888;
    }
    .signatory-cell {
      text-align: right;
    }
    .signatory-block {
      display: inline-block;
      width: 260px;
      max-width: 100%;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .signatory-company {
      font-size: 11px;
      font-weight: bold;
      color: #333;
      margin-bottom: 7px;
    }
    .signatory-assets {
      display: inline-flex;
      align-items: flex-end;
      justify-content: center;
      gap: 12px;
      max-width: 260px;
      min-height: 72px;
      margin-bottom: 6px;
    }
    .stamp-frame,
    .signature-frame {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      min-width: 0;
    }
    .stamp-frame {
      width: 92px;
      min-height: 72px;
    }
    .signature-frame {
      width: 150px;
      min-height: 58px;
    }
    .stamp-image {
      display: block;
      max-width: 92px;
      max-height: 92px;
      object-fit: contain;
    }
    .signature-image {
      display: block;
      max-width: 150px;
      max-height: 68px;
      object-fit: contain;
    }
    .signatory-label {
      display: block;
      padding-top: 4px;
      border-top: 1px solid #bbb;
      font-size: 10px;
      color: #555;
    }
  </style>
</head>
<body>

  <!-- Header -->
  <table class="header-table">
    <tr>
      <td>
        ${bp?.logoDataUrl ? `<img src="${bp.logoDataUrl}" style="max-height: 60px; max-width: 200px; margin-bottom: 8px;" alt="Logo"><br>` : ''}
        <div class="company-title">${escapeHtml(bp?.displayName || 'Buminex Pharmtech Solutions')}</div>
        <div class="company-details">
          ${bp?.legalName ? `<strong>${escapeHtml(bp.legalName)}</strong><br>` : ''}
          ${escapeHtml(bp?.addressLine1 || '')} ${escapeHtml(bp?.addressLine2 || '')}<br>
          ${escapeHtml(bp?.city || '')}, ${escapeHtml(bp?.state || '')} - ${escapeHtml(bp?.postalCode || '')}, ${escapeHtml(bp?.country || 'India')}<br>
          ${bp?.primaryPhone ? `Phone: ${escapeHtml(bp.primaryPhone)} | ` : ''}
          ${bp?.primaryEmail ? `Email: ${escapeHtml(bp.primaryEmail)}` : ''}<br>
          ${bp?.gstin ? `<strong>GSTIN:</strong> ${escapeHtml(bp.gstin)} | ` : ''}
          ${bp?.pan ? `<strong>PAN:</strong> ${escapeHtml(bp.pan)}` : ''}
        </div>
      </td>
      <td class="quote-title-box">
        <div class="quote-title">Quotation</div>
        <div style="font-size: 14px; font-weight: bold; color: ${primaryColor};">
          ${escapeHtml(data.quotationNumber)}
        </div>
        <div style="font-size: 11px; color: #666; margin-top: 4px;">
          <strong>Date:</strong> ${new Date(data.quotationDate).toLocaleDateString()}<br>
          ${data.validUntil ? `<strong>Valid Until:</strong> ${new Date(data.validUntil).toLocaleDateString()}<br>` : ''}
          <strong>Revision:</strong> #${data.revisionNumber}
        </div>
      </td>
    </tr>
  </table>

  <!-- Customer & Shipping Info -->
  <table class="info-grid">
    <tr>
      <td>
        <div class="section-heading">Customer Details</div>
        <strong>${escapeHtml(data.companyNameSnapshot)}</strong><br>
        ${data.companyGstinSnapshot ? `GSTIN: ${escapeHtml(data.companyGstinSnapshot)}<br>` : ''}
        ${data.companyPanSnapshot ? `PAN: ${escapeHtml(data.companyPanSnapshot)}<br>` : ''}
        ${data.contactNameSnapshot ? `Contact Person: ${escapeHtml(data.contactNameSnapshot)}<br>` : ''}
        ${data.contactPhoneSnapshot ? `Phone: ${escapeHtml(data.contactPhoneSnapshot)}<br>` : ''}
        ${data.contactEmailSnapshot ? `Email: ${escapeHtml(data.contactEmailSnapshot)}` : ''}
      </td>
      <td>
        <div class="section-heading">Address Details</div>
        ${
          data.billingAddressSnapshot
            ? `<strong>Billing Address:</strong><br>${escapeHtml(data.billingAddressSnapshot.addressLine1 || '')} ${escapeHtml(data.billingAddressSnapshot.addressLine2 || '')}, ${escapeHtml(data.billingAddressSnapshot.city || '')}, ${escapeHtml(data.billingAddressSnapshot.state || '')} - ${escapeHtml(data.billingAddressSnapshot.postalCode || '')}<br>`
            : ''
        }
        ${
          data.shippingAddressSnapshot
            ? `<strong style="margin-top: 5px; display: inline-block;">Shipping Address:</strong><br>${escapeHtml(data.shippingAddressSnapshot.addressLine1 || '')} ${escapeHtml(data.shippingAddressSnapshot.addressLine2 || '')}, ${escapeHtml(data.shippingAddressSnapshot.city || '')}, ${escapeHtml(data.shippingAddressSnapshot.state || '')} - ${escapeHtml(data.shippingAddressSnapshot.postalCode || '')}`
            : ''
        }
      </td>
    </tr>
  </table>

  <!-- Line Items Table -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width: 4%;">#</th>
        <th style="width: 32%;">Item Specifications</th>
        <th style="width: 10%; text-align: right;">Qty</th>
        <th style="width: 12%; text-align: right;">Unit Rate</th>
        <th style="width: 10%; text-align: right;">Discount</th>
        <th style="width: 11%; text-align: right;">Taxable</th>
        <th style="width: 9%; text-align: right;">GST</th>
        <th style="width: 12%; text-align: right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <!-- Totals Summary -->
  <table class="totals-table">
    <tr>
      <td>Subtotal:</td>
      <td style="text-align: right;">${formatCurrencyPdf(data.subtotal, currency)}</td>
    </tr>
    ${
      Number(data.itemDiscountAmount) > 0
        ? `<tr>
            <td>Line Item Discounts:</td>
            <td style="text-align: right; color: #168A56;">- ${formatCurrencyPdf(data.itemDiscountAmount, currency)}</td>
          </tr>`
        : ''
    }
    ${
      Number(data.quotationDiscountAmount) > 0
        ? `<tr>
            <td>Header Discount:</td>
            <td style="text-align: right; color: #168A56;">- ${formatCurrencyPdf(data.quotationDiscountAmount, currency)}</td>
          </tr>`
        : ''
    }
    <tr>
      <td style="font-weight: bold;">Taxable Amount:</td>
      <td style="text-align: right; font-weight: bold;">${formatCurrencyPdf(data.taxableAmount, currency)}</td>
    </tr>
    ${
      data.taxMode === 'CGST_SGST'
        ? `<tr>
            <td>CGST:</td>
            <td style="text-align: right;">${formatCurrencyPdf(data.cgstAmount, currency)}</td>
          </tr>
          <tr>
            <td>SGST:</td>
            <td style="text-align: right;">${formatCurrencyPdf(data.sgstAmount, currency)}</td>
          </tr>`
        : data.taxMode === 'IGST'
          ? `<tr>
              <td>IGST:</td>
              <td style="text-align: right;">${formatCurrencyPdf(data.igstAmount, currency)}</td>
            </tr>`
          : ''
    }
    ${
      Number(data.freightAmount) > 0
        ? `<tr>
            <td>Freight Amount:</td>
            <td style="text-align: right;">${formatCurrencyPdf(data.freightAmount, currency)}</td>
          </tr>`
        : ''
    }
    ${
      Number(data.otherCharges) > 0
        ? `<tr>
            <td>Other Charges:</td>
            <td style="text-align: right;">${formatCurrencyPdf(data.otherCharges, currency)}</td>
          </tr>`
        : ''
    }
    ${
      Number(data.roundOffAmount) !== 0
        ? `<tr>
            <td>Round-off:</td>
            <td style="text-align: right;">${formatCurrencyPdf(data.roundOffAmount, currency)}</td>
          </tr>`
        : ''
    }
    <tr class="grand-total">
      <td>Grand Total:</td>
      <td style="text-align: right;">${formatCurrencyPdf(data.grandTotal, currency)}</td>
    </tr>
  </table>

  <!-- Amount In Words -->
  ${
    data.amountInWords
      ? `<div class="words-box">
          <strong>Amount in words:</strong> ${escapeHtml(data.amountInWords)}
        </div>`
      : ''
  }

  <!-- Terms & Remarks -->
  ${
    data.termsAndConditions || data.remarks || bank
      ? `<table class="terms-grid">
          <tr>
            <td>
              ${
                data.termsAndConditions
                  ? `<div class="section-heading">Terms & Conditions</div>
                     <div style="font-size: 10px; color: #555; white-space: pre-line;">${escapeHtml(data.termsAndConditions)}</div>`
                  : ''
              }
              ${
                data.remarks
                  ? `<div class="section-heading" style="margin-top: 10px;">Remarks</div>
                     <div style="font-size: 10px; color: #555; white-space: pre-line;">${escapeHtml(data.remarks)}</div>`
                  : ''
              }
            </td>
            <td>
              ${
                bank
                  ? `<div class="section-heading">Bank Details for Payment</div>
                     <div style="font-size: 10px; color: #444;">
                       <strong>Bank Name:</strong> ${escapeHtml(bank.bankName)}<br>
                       <strong>Account Name:</strong> ${escapeHtml(bank.accountName)}<br>
                       <strong>Account No:</strong> ${escapeHtml(bank.accountNumber)}<br>
                       ${bank.ifscCode ? `<strong>IFSC Code:</strong> ${escapeHtml(bank.ifscCode)}<br>` : ''}
                       ${bank.branchName ? `<strong>Branch:</strong> ${escapeHtml(bank.branchName)}<br>` : ''}
                       ${bank.swiftCode ? `<strong>SWIFT Code:</strong> ${escapeHtml(bank.swiftCode)}` : ''}
                     </div>`
                  : ''
              }
            </td>
          </tr>
        </table>`
      : ''
  }

  <!-- Signatory -->
  <table class="document-footer">
    <tr>
      <td>
        <span class="computer-note">This is a computer-generated quotation document.</span>
      </td>
      <td class="signatory-cell">
        <div class="signatory-block">
          <div class="signatory-company">For ${escapeHtml(bp?.displayName || 'Buminex Pharmtech Solutions')}</div>
          ${signatoryAssetsHtml}
          <span class="signatory-label">Authorised Signatory</span>
        </div>
      </td>
    </tr>
  </table>

</body>
</html>`;
}
