import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, open, readFile, rm, writeFile, cp } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertDisposableTenantDatabase, TwoFirmFixture, type TenantFixture } from './helpers/two-firm-fixture.js';

const testUrl = process.env.WAVE11_TEST_DATABASE_URL;
const restoreUrl = process.env.WAVE11_RESTORE_DATABASE_URL;
const suite = process.env.WAVE11_BROWSER_ENABLED === '1' && testUrl && restoreUrl ? describe : describe.skip;

// Opt-in acceptance against the real running frontend and a separately migrated
// local database. Browser requests are routed to a real isolated API, never mocked.
suite.sequential('Wave 11 desktop approval and database/storage recovery', () => {
  let db: PrismaClient; let restored: PrismaClient; let fixture: TwoFirmFixture;
  let a: TenantFixture; let b: TenantFixture; let reviewer: TenantFixture['admin'];
  let browser: Browser; let server: Server; let base: string; let root: string;
  let storageRoot: string; let restoredCreated = false; let invoiceId: number;
  let approvalId: string; let planId: number; let documentId: number;
  const origin = 'http://localhost:5173';
  const password = `Qa!${randomBytes(24).toString('base64url')}`;
  const evidence: Record<string, unknown> = {};
  const pages = new Map<number, Page>();

  async function visible(page: Page, text: string) {
    await page.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 30000 }, text);
  }
  async function click(page: Page, text: string, selector = 'button') {
    await page.waitForFunction((value, query) => Array.from(document.querySelectorAll(query)).some((element) => element.textContent?.trim() === value && !(element as HTMLButtonElement).disabled), { timeout: 30000 }, text, selector);
    await page.evaluate((value, query) => {
      const element = Array.from(document.querySelectorAll(query)).find((node) => node.textContent?.trim() === value && !(node as HTMLButtonElement).disabled) as HTMLElement;
      element.click();
    }, text, selector);
  }
  async function api(page: Page, method: string, endpoint: string, body?: unknown) {
    return page.evaluate(async (input) => {
      const response = await fetch(input.base + '/api/v1' + input.endpoint, { method: input.method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: input.body === undefined ? undefined : JSON.stringify(input.body) });
      return { status: response.status, json: await response.json() };
    }, { base, method, endpoint, body });
  }
  async function login(actor: TenantFixture['admin']) {
    const context = await browser.createBrowserContext(); const page = await context.newPage();
    page.setDefaultTimeout(30000); await page.setViewport({ width: 1440, height: 1050 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const target = new URL(request.url());
      if (target.pathname.startsWith('/api/v1/')) {
        // No application API request is allowed to reach port 3004.
        const headers = { ...request.headers() }; delete headers.host;
        void request.continue({ url: base + target.pathname + target.search, headers });
      } else if (target.origin === origin || ['data:', 'blob:', 'about:'].includes(target.protocol)) void request.continue();
      else void request.abort('blockedbyclient');
    });
    await page.goto(origin + '/login', { waitUntil: 'networkidle2' });
    await page.type('input[name="identifier"]', actor.email); await page.type('input[name="password"]', password);
    await click(page, 'Sign in');
    await page.waitForFunction(() => !['/login', '/change-password'].includes(location.pathname), { timeout: 30000 });
    pages.set(actor.id, page); return page;
  }
  async function navigate(page: Page, route: string) { await page.goto(origin + route, { waitUntil: 'networkidle2' }); }
  async function fillLabel(page: Page, label: string, value: string) {
    const selector = await page.evaluate((text) => {
      const label = Array.from(document.querySelectorAll('label')).find((node) => node.textContent?.replace(/\s*\*$/, '').trim() === text);
      if (!label?.htmlFor) throw new Error('Field label unavailable'); return `[id="${CSS.escape(label.htmlFor)}"]`;
    }, label);
    await page.type(selector, value);
  }
  async function screenshot(page: Page, filename: string) {
    await page.waitForFunction(() => {
      let element = document.querySelector('[role="dialog"]');
      while (element) { if (Number(getComputedStyle(element).opacity) < 1) return false; element = element.parentElement; }
      return true;
    });
    await page.screenshot({ path: path.join(root, filename), fullPage: true });
  }
  function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)).digest('hex'); }
  async function databaseManifest(client: PrismaClient) {
    const tables = await client.$queryRaw<Array<{ TABLE_NAME: string }>>`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`;
    const result: Record<string, { count: number; hash: string }> = {};
    for (const { TABLE_NAME: name } of tables) {
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Unexpected schema identifier');
      const rows = await client.$queryRawUnsafe<unknown[]>(`SELECT * FROM \`${name}\``);
      const canonicalRows = rows.map((row) => JSON.stringify(row, (_, item) => typeof item === 'bigint' ? item.toString() : item)).sort();
      result[name] = { count: rows.length, hash: digest(canonicalRows) };
    }
    return result;
  }
  async function mysqlCommand(binary: string, args: string[], options: { input?: string; output?: string }) {
    const input = options.input ? await open(options.input, 'r') : undefined;
    const output = options.output ? await open(options.output, 'w', 0o600) : undefined;
    const errors = await open(path.join(root, `${binary}-stderr.log`), 'w', 0o600);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(`/usr/local/mysql/bin/${binary}`, args, { stdio: [input?.fd ?? 'ignore', output?.fd ?? 'ignore', errors.fd] });
        child.on('error', reject); child.on('exit', resolve);
      });
      if (code !== 0) throw new Error(`${binary} failed; inspect the private acceptance log`);
    } finally { await input?.close(); await output?.close(); await errors.close(); }
  }
  beforeAll(async () => {
    assertDisposableTenantDatabase(testUrl!, '11'); assertDisposableTenantDatabase(restoreUrl!, '11');
    if (new URL(testUrl!).pathname === new URL(restoreUrl!).pathname || !new URL(restoreUrl!).pathname.startsWith('/wave11_test_restore_')) throw new Error('A separate, fresh recovery schema is required');
    root = await mkdtemp(path.join(process.env.WAVE11_BROWSER_ARTIFACT_ROOT ?? os.tmpdir(), 'wave11-browser-'));
    storageRoot = path.join(root, 'storage'); await mkdir(storageRoot, { mode: 0o700 });
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', testUrl!); vi.stubEnv('OUTBOX_WORKER_ENABLED', 'false'); vi.stubEnv('FRONTEND_URL', origin);
    db = new PrismaClient({ datasources: { db: { url: testUrl! } } }); fixture = new TwoFirmFixture(db);
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    vi.doMock('../src/config/storage.config.js', () => ({ storageConfig: { root: storageRoot, publicAssetDirectories: ['items', 'logos', 'signatures', 'stamps', 'firm-assets'], firmAssetDirectory: 'firm-assets', itemImageDirectory: 'items', brandingDirectories: { logo: 'logos', signature: 'signatures', stamp: 'stamps' }, quotationAttachmentDirectory: 'quotation-attachments', quotationDocumentDirectory: 'quotation-documents' }, firmPublicAssetDirectory: (id: number, directory: string) => `firm-assets/${id}/${directory}`, firmProtectedDirectory: (directory: string, id: number) => `${directory}/${id}` }));
    a = await fixture.createTenant('Browser approval requester'); b = await fixture.createTenant('Browser foreign firm');
    reviewer = await fixture.createActor(a.firm.id, 'FIRM_ADMIN');
    await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['invoices.view', 'invoices.issue', 'invoices.documents', 'automation.view'] } });
    const passwordHash = await bcrypt.hash(password, 10);
    for (const actor of [a.admin, a.reader, b.admin, reviewer]) await db.user.update({ where: { id: actor.id }, data: { passwordHash } });
    await db.user.update({ where: { id: a.reader.id }, data: { name: 'Approval requester' } });
    await db.user.update({ where: { id: reviewer.id }, data: { name: 'Independent reviewer' } });
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js');
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const plan = await db.plan.create({ data: { name: 'Isolated browser acceptance', slug: randomUUID(), versions: { create: { revision: 1, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.map((featureKey) => ({ featureKey })) } } } }, include: { versions: true } });
    planId = plan.id; await fixture.publishPlanVersion(plan.versions[0]!.id);
    for (const tenant of [a, b]) await db.firmSubscription.create({ data: { firmId: tenant.firm.id, planVersionId: plan.versions[0]!.id, status: 'ACTIVE', authorId: tenant.admin.id, reason: 'Isolated browser acceptance', effectiveFrom: new Date(Date.now() - 1000) } });
    const { app } = await import('../src/bootstrap/app.js'); server = app.listen(0, 'localhost'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Isolated listener unavailable'); base = `http://localhost:${address.port}`;
    browser = await puppeteer.launch({ headless: true });
    const admin = await login(a.admin);
    expect((await api(admin, 'PUT', '/billing-settings', { expectedVersion: 0, config: { schemaVersion: 1, registration: 'UNREGISTERED', sellerStateCode: '24', einvoiceRequired: false, prefixes: { INVOICE: 'INV', PROFORMA: 'PF', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN' }, template: 'STANDARD', primaryColour: '#168A56', paymentInstructions: '', termsAndConditions: '' } })).status).toBe(200);
    expect((await api(admin, 'POST', '/approvals/policies/INVOICE_ISSUE/publish', { expectedVersion: 0, definition: { action: 'INVOICE_ISSUE', enabled: true, expiresAfterHours: 48, authority: 'OTHER_FIRM_ADMIN' } })).status).toBe(201);
    const quotation = await api(admin, 'POST', '/quotations', { companyId: a.company.id, billingAddressId: a.address.id, quotationDate: new Date().toISOString().slice(0, 10), currency: 'INR', taxMode: 'NONE', items: [{ itemName: 'Isolated approval review service', measurementUnit: 'HOUR', quantity: 1, unitRate: 20, gstRate: 0 }] });
    expect(quotation.status).toBe(201); const quotationId = quotation.json.data.quotation.id;
    expect((await api(admin, 'PATCH', `/quotations/${quotationId}/status`, { status: 'SENT' })).status).toBe(200);
    expect((await api(admin, 'PATCH', `/quotations/${quotationId}/status`, { status: 'ACCEPTED' })).status).toBe(200);
    const draft = await api(admin, 'POST', '/invoices/from-quotation', { sourceRevisionId: quotationId, supply: { isExempt: true, placeOfSupplyStateCode: '24', placeOfSupplyBasis: 'SERVICES_GENERAL', explanation: '' }, customFieldValues: {}, lineMetadata: [{ lineNumber: 1, hsnCode: null, supplyType: 'SERVICE' }], idempotencyKey: randomUUID() });
    expect(draft.status).toBe(201); invoiceId = draft.json.data.document.id;
    evidence.sourceQuotationId = quotationId;
    evidence.database = new URL(testUrl!).pathname.slice(1); evidence.startedAt = new Date().toISOString();
    console.info(JSON.stringify({ event: 'wave11.browser.started', artifactRoot: root }));
  }, 120000);
  afterAll(async () => {
    try {
      await browser?.close();
      if (server?.listening) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
      await restored?.$disconnect();
      if (restoredCreated) await db.$executeRawUnsafe(`DROP DATABASE \`${new URL(restoreUrl!).pathname.slice(1)}\``);
      if (fixture) await fixture.cleanup();
      if (planId) await db.plan.update({ where: { id: planId }, data: { archivedAt: new Date() } });
    } finally {
      if (root) await writeFile(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
      await db?.$disconnect(); vi.doUnmock('../src/core/database/prisma.js'); vi.doUnmock('../src/config/storage.config.js'); vi.unstubAllEnvs();
    }
  }, 60000);
  it('requests, independently reviews and performs one exact invoice action through the desktop UI', async () => {
    const requester = await login(a.reader); await navigate(requester, `/invoices/${invoiceId}`);
    await visible(requester, 'Issue invoice'); await click(requester, 'Issue invoice'); await click(requester, 'Confirm issuance');
    await visible(requester, 'Approval requested.');
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('DRAFT');
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { firmId: a.firm.id, requesterId: a.reader.id } }); approvalId = approval.id;
    await navigate(requester, '/approvals'); await visible(requester, 'Cancel request');
    expect(await requester.$$eval('button', (buttons) => buttons.some((button) => button.textContent?.trim() === 'Approve'))).toBe(false);
    expect((await api(requester, 'POST', `/approvals/${approvalId}/decisions`, { decision: 'APPROVED', reason: 'Self approval must be rejected' })).status).toBe(403);
    await screenshot(requester, 'requester-pending.png');
    const reviewerPage = await login(reviewer); await navigate(reviewerPage, '/approvals'); await visible(reviewerPage, 'Approval requester');
    await click(reviewerPage, 'View request'); await visible(reviewerPage, 'Approval request details'); await screenshot(reviewerPage, 'independent-request-detail.png');
    await click(reviewerPage, 'Close'); await click(reviewerPage, 'Approve');
    await reviewerPage.type('textarea[name="reason"]', 'Independent review of the exact INR 20.00 invoice'); await click(reviewerPage, 'Confirm');
    await visible(reviewerPage, 'Approval recorded. The requester can now perform this action.');
    await reviewerPage.waitForFunction(() => document.querySelector('[role="dialog"]') === null);
    expect(await db.approvalDecision.findFirst({ where: { requestId: approvalId, actorId: reviewer.id, decision: 'APPROVED' } })).not.toBeNull();
    await navigate(requester, '/approvals'); await click(requester, 'Perform approved action'); await visible(requester, 'Perform this approved action?'); await click(requester, 'Confirm');
    await visible(requester, 'The approved action completed.'); await visible(requester, 'Performed');
    expect(await requester.$$eval('button', (buttons) => buttons.some((button) => button.textContent?.trim() === 'Perform approved action'))).toBe(false);
    const issued = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(issued.status).toBe('ISSUED'); expect(issued.grandTotal.toFixed(2)).toBe('20.00'); expect(issued.documentNumber).toMatch(/^INV\//);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } })).consumedAt).not.toBeNull();
    const replay = await api(requester, 'POST', `/invoices/${invoiceId}/issue`, { expectedVersion: issued.version - 1, confirmedTotal: '20.00' });
    expect(replay.status).toBe(200); expect(replay.json.data.document.documentNumber).toBe(issued.documentNumber);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).version).toBe(issued.version);
    expect(await db.invoiceStatusHistory.count({ where: { invoiceId, toStatus: 'ISSUED' } })).toBe(1);
    await screenshot(requester, 'requester-performed.png');
    evidence.approval = { status: 'PASS', invoiceId, approvalId, documentNumber: issued.documentNumber, total: '20.00', independentDecision: true, selfApprovalDenied: true, idempotentReplay: true, issueTransitions: 1 };
  }, 180000);
  it('reconciles the same quotation and approved invoice through receipts, refund, reversal and credit note', async () => {
    const admin = pages.get(a.admin.id)!;
    await navigate(admin, `/payments?companyId=${a.company.id}&currency=INR`); await click(admin, 'Record receipt'); await visible(admin, 'Record confirmed receipt');
    await fillLabel(admin, 'Receipt amount', '10.00'); await fillLabel(admin, 'Receipt reference', 'ISOLATED-COMPOSED-RECEIPT');
    await admin.click('[role="dialog"] input[type="checkbox"]'); await click(admin, 'Record confirmed receipt');
    await visible(admin, 'Customer receipt recorded.'); await admin.waitForFunction(() => document.querySelector('[role="dialog"]') === null);
    const first = await db.customerPayment.findFirstOrThrow({ where: { firmId: a.firm.id, reference: 'ISOLATED-COMPOSED-RECEIPT' } });
    const settlement = async () => { const result = await api(admin, 'GET', `/receivables/invoices/${invoiceId}`); expect(result.status).toBe(200); return result.json.data; };
    expect((await api(admin, 'POST', `/payments/${first.id}/allocate`, { idempotencyKey: randomUUID(), allocations: [{ invoiceId, amount: '10.00' }] })).status).toBe(200);
    expect(await settlement()).toMatchObject({ allocated: '10.00', outstanding: '10.00', settlementStatus: 'PARTIAL' });
    const second = await api(admin, 'POST', '/payments', { companyId: a.company.id, currency: 'INR', amount: '15.00', method: 'CASH', receivedDate: new Date().toISOString().slice(0, 10), confirmed: true, idempotencyKey: randomUUID(), allocations: [{ invoiceId, amount: '10.00' }] });
    expect(second.status).toBe(201); const secondId = second.json.data.payment.id;
    expect(await settlement()).toMatchObject({ outstanding: '0.00', settlementStatus: 'PAID' });
    const refund = { idempotencyKey: randomUUID(), amount: '5.00', paidDate: new Date().toISOString().slice(0, 10), reference: 'ISOLATED-ALREADY-PAID-REFUND', reason: 'Record synthetic refund already paid outside ERP', confirmed: true };
    expect((await api(admin, 'POST', `/payments/${secondId}/refunds`, refund)).status).toBe(201);
    expect((await api(admin, 'POST', `/payments/${secondId}/refunds`, refund)).status).toBe(201);
    const reversal = await api(admin, 'POST', `/payments/${secondId}/reverse`, { idempotencyKey: randomUUID(), reason: 'Synthetic correction of remaining receipt' });
    expect(reversal.status).toBe(200); expect(reversal.json.data.payment).toMatchObject({ status: 'REVERSED', refunded: '5.00', reversal: { amount: '10.00' } });
    expect(await settlement()).toMatchObject({ allocated: '10.00', outstanding: '10.00' });
    const credit = await api(admin, 'POST', '/billing-adjustments', { sourceInvoiceId: invoiceId, kind: 'CREDIT_NOTE', reason: 'Synthetic service credit after receipt correction', idempotencyKey: randomUUID(), gstReductionEligible: false, annualReturnFiledAt: null, recipientItcReversalConfirmed: false, lines: [{ sourceLineNumber: 1, quantity: '1', unitRate: '5.00' }], customFieldValues: {} });
    expect(credit.status).toBe(201); const note = credit.json.data.document;
    expect((await api(admin, 'POST', `/billing-adjustments/${note.id}/issue`, { expectedVersion: note.version, confirmedTotal: note.grandTotal })).status).toBe(200);
    expect(await settlement()).toMatchObject({ adjustedTotal: '15.00', allocated: '10.00', outstanding: '5.00' });
    expect((await api(admin, 'POST', '/payments', { companyId: a.company.id, currency: 'INR', amount: '5.00', method: 'CASH', receivedDate: new Date().toISOString().slice(0, 10), confirmed: true, idempotencyKey: randomUUID(), allocations: [{ invoiceId, amount: '5.00' }] })).status).toBe(201);
    expect(await settlement()).toMatchObject({ adjustedTotal: '15.00', allocated: '15.00', outstanding: '0.00', settlementStatus: 'PAID' });
    expect(await db.customerRefund.count({ where: { paymentId: secondId } })).toBe(1);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).grandTotal.toFixed(2)).toBe('20.00');
    await navigate(admin, `/payments/${secondId}`); await visible(admin, 'ISOLATED-ALREADY-PAID-REFUND'); await visible(admin, 'Cancelled'); await screenshot(admin, 'composed-receipt-refund-reversal.png');
    await navigate(admin, `/invoices/${invoiceId}`); await visible(admin, 'Paid'); await screenshot(admin, 'composed-invoice-settlement.png');
    evidence.composedFinancialJourney = { status: 'PASS', quotationId: evidence.sourceQuotationId, invoiceId, receiptCreatedThroughUi: first.id, correctedReceiptId: secondId, creditNoteId: note.id, originalInvoice: '20.00', credit: '5.00', adjustedTotal: '15.00', allocated: '15.00', outstanding: '0.00', refund: '5.00', reversal: '10.00', duplicateRefundCount: 1 };
  }, 120000);
  it('denies foreign-firm access in the browser and downloads a real protected PDF', async () => {
    const foreign = await login(b.admin); await navigate(foreign, '/approvals'); await visible(foreign, 'No approval requests');
    expect((await api(foreign, 'GET', `/invoices/${invoiceId}`)).status).toBe(404);
    expect((await api(foreign, 'POST', `/approvals/${approvalId}/decisions`, { decision: 'APPROVED', reason: 'Foreign firm must be rejected' })).status).toBe(404);
    await navigate(foreign, `/invoices/${invoiceId}`); await visible(foreign, 'not found'); await screenshot(foreign, 'foreign-firm-denied.png');
    const requester = pages.get(a.reader.id)!; await navigate(requester, `/invoices/${invoiceId}`); await click(requester, 'Generate PDF version');
    await visible(requester, 'PDF version generated.');
    const document = await db.invoiceDocument.findFirstOrThrow({ where: { invoiceId } }); documentId = document.id;
    const response = await api(requester, 'GET', `/invoices/${invoiceId}/documents`); expect(response.status).toBe(200);
    const pdf = await requester.evaluate(async (endpoint) => { const response = await fetch(endpoint, { credentials: 'include' }); return { status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'), bytes: Array.from(new Uint8Array(await response.arrayBuffer())) }; }, `${base}/api/v1/invoices/${invoiceId}/documents/${documentId}/download`);
    expect(pdf.status).toBe(200); expect(pdf.type).toContain('application/pdf'); expect(pdf.cache).toBe('private, no-store');
    expect(createHash('sha256').update(Buffer.from(pdf.bytes)).digest('hex')).toBe(document.fileHash);
    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    await writeFile(path.join(root, 'issued-invoice.pdf'), Buffer.from(pdf.bytes), { mode: 0o600 });
    expect((await api(foreign, 'GET', `/invoices/${invoiceId}/documents/${documentId}/download`)).status).toBe(404);
    evidence.accessAndPdf = { status: 'PASS', foreignInboxEmpty: true, foreignRecordAndDecisionDenied: true, foreignPdfDenied: true, documentId, bytes: pdf.bytes.length, hash: document.fileHash };
  }, 120000);
  it('restores a consistent database and protected storage snapshot without losing financial or approval evidence', async () => {
    if (!evidence.accessAndPdf || !evidence.composedFinancialJourney) throw new Error('Complete the real browser, financial and PDF journeys before recovery');
    await browser.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const source = new URL(testUrl!); const target = new URL(restoreUrl!);
    const triggers = await db.$queryRaw<Array<{ TRIGGER_NAME: string }>>`SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME`;
    const triggerStatements: string[] = [];
    for (const { TRIGGER_NAME: name } of triggers) {
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Unexpected trigger identifier');
      const [definition] = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`SHOW CREATE TRIGGER \`${name}\``);
      // Some Prisma/MySQL combinations expose SHOW metadata as f0, f1, f2.
      const statement = definition?.['SQL Original Statement'] ?? definition?.f2;
      if (typeof statement !== 'string' || !/^CREATE\b[\s\S]*\bTRIGGER\b/.test(statement)) throw new Error('Trigger definition missing');
      triggerStatements.push(statement);
    }
    await writeFile(path.join(root, 'trigger-definitions.json'), JSON.stringify(triggerStatements, null, 2), { mode: 0o600 });
    // The mysql client limits custom delimiters to 15 characters.
    const delimiter = `B_${randomBytes(6).toString('hex')}`;
    if (triggerStatements.some((statement) => statement.includes(delimiter))) throw new Error('Trigger delimiter collision');
    await writeFile(path.join(root, 'triggers.sql'), `DELIMITER ${delimiter}\n${triggerStatements.map((statement) => statement + delimiter).join('\n')}\nDELIMITER ;\n`, { mode: 0o600 });
    const targetName = target.pathname.slice(1); const before = await databaseManifest(db);
    await db.$executeRawUnsafe(`CREATE DATABASE \`${targetName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); restoredCreated = true;
    const credentials = path.join(root, 'mysql-private.cnf');
    const clientConfig = (url: URL) => `[client]\nhost=${url.hostname}\nport=${url.port || '3306'}\nuser=${JSON.stringify(decodeURIComponent(url.username))}\npassword=${JSON.stringify(decodeURIComponent(url.password))}\n`;
    const started = performance.now(); let exportMs: number; let importMs: number;
    try {
      await writeFile(credentials, clientConfig(source), { mode: 0o600 });
      // The local 9.7 client emits a delimiter error for SIGNAL-only triggers.
      // Preserve exact SHOW CREATE statements with an explicit collision-free delimiter.
      await mysqlCommand('mysqldump', [`--defaults-extra-file=${credentials}`, '--single-transaction', '--routines', '--skip-triggers', '--hex-blob', '--set-gtid-purged=OFF', '--no-tablespaces', source.pathname.slice(1)], { output: path.join(root, 'database.sql') });
      await cp(storageRoot, path.join(root, 'restored-storage'), { recursive: true }); exportMs = performance.now() - started;
      const importStarted = performance.now(); await writeFile(credentials, clientConfig(target), { mode: 0o600 });
      await mysqlCommand('mysql', [`--defaults-extra-file=${credentials}`, `--database=${targetName}`], { input: path.join(root, 'database.sql') });
      await mysqlCommand('mysql', [`--defaults-extra-file=${credentials}`, `--database=${targetName}`], { input: path.join(root, 'triggers.sql') }); importMs = performance.now() - importStarted;
    } finally { await rm(credentials, { force: true }); }
    restored = new PrismaClient({ datasources: { db: { url: restoreUrl! } } });
    type Trigger = { TRIGGER_NAME: string; ACTION_STATEMENT: string; EVENT_MANIPULATION: string; ACTION_TIMING: string; EVENT_OBJECT_TABLE: string };
    const restoredTriggers = await restored.$queryRaw<Trigger[]>`SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, EVENT_OBJECT_TABLE, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME`;
    const sourceTriggers = await db.$queryRaw<Trigger[]>`SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, EVENT_OBJECT_TABLE, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY TRIGGER_NAME`;
    // The text-protocol client strips the optional final statement terminator.
    const normalise = (rows: Trigger[]) => rows.map((row) => ({ ...row, ACTION_STATEMENT: row.ACTION_STATEMENT.trim().replace(/;$/, '') }));
    expect(normalise(restoredTriggers)).toEqual(normalise(sourceTriggers));
    const after = await databaseManifest(restored); expect(after).toEqual(before);
    const invoice = await restored.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice.status).toBe('ISSUED'); expect(invoice.grandTotal.toFixed(2)).toBe('20.00');
    const { ReceivablesRepository } = await import('../src/modules/payments/receivables.repository.js');
    expect(await new ReceivablesRepository(restored).invoice(a.firm.id, a.admin.id, invoiceId)).toMatchObject({ adjustedTotal: '15.00', allocated: '15.00', outstanding: '0.00', settlementStatus: 'PAID' });
    expect((await restored.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } })).consumedAt).not.toBeNull();
    await expect(restored.approvalDecision.updateMany({ where: { requestId: approvalId }, data: { reason: 'Forbidden change after restore' } })).rejects.toThrow('Approval decisions are immutable');
    const file = await restored.invoiceDocument.findUniqueOrThrow({ where: { id: documentId } });
    const restoredFile = await readFile(path.join(root, 'restored-storage', file.filePath));
    expect(createHash('sha256').update(restoredFile).digest('hex')).toBe(file.fileHash);
    const { storageConfig } = await import('../src/config/storage.config.js'); const originalRoot = storageConfig.root;
    try {
      storageConfig.root = path.join(root, 'restored-storage');
      const { InvoiceDocumentsRepository } = await import('../src/modules/invoices/documents/invoice-documents.repository.js');
      const download = await new InvoiceDocumentsRepository(restored).download(a.firm.id, invoiceId, documentId, 'INVOICE');
      expect(download.buffer).toEqual(restoredFile);
      await expect(new InvoiceDocumentsRepository(restored).download(b.firm.id, invoiceId, documentId, 'INVOICE')).rejects.toMatchObject({ statusCode: 404 });
    } finally { storageConfig.root = originalRoot; }
    evidence.recovery = { status: 'PASS', exportMs, importMs, verifiedTotalMs: performance.now() - started, tables: Object.keys(before).length, triggers: triggers.length, rows: Object.values(before).reduce((total, table) => total + table.count, 0), everyTableCountAndHashMatched: true, invoiceAndApprovalPreserved: true, restoredPdfReadAndTenantDenialVerified: true, schema: targetName };
    await writeFile(path.join(root, 'snapshot-manifest.json'), JSON.stringify(before, null, 2), { mode: 0o600 });
    console.info(JSON.stringify({ event: 'wave11.recovery.completed', ...evidence.recovery as object }));
  }, 120000);
});
