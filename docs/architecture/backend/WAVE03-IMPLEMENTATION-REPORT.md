# Wave 03 implementation and validation

Implementation date: 27 October 2026. The approved defaults preserve quotation calculations and continuous legacy numbering. Shared settings apply to future financial workflows. The local worker is disabled by default; only transactional in-app notification delivery is registered.

## A. Baseline inventory

Repository metadata was read directly, without executing Git:

| Checkout | Branch | Starting commit |
| --- | --- | --- |
| backend | feat/wave3 | b7f3fbaef8cd8f8f64db7d6feb22e3a96472afaa |
| frontend | feat/wave3 | ee166ea6e323ee61825d7d5aa530fd6713297b75 |

Working-tree status and Git diff were not requested or executed. Existing files were changed with targeted edits.

Already present: firm isolation, authenticated firm selection, RBAC, the Wave 02 feature registry and entitlement evaluator, transactional quota accounting, quotation Decimal calculations, quotation document and communication histories, audit helpers, and PDF/storage/SMTP integrations. Dependencies are hoisted in the parent workspace; no installation was needed.

Partially present: quotation-specific money/tax math; a legacy quotation counter; unversioned business defaults; synchronous PDF and mail workflows. The configured quotation reset rule was stored but ignored by allocation. SMTP has no provider idempotency guarantee.

New: neutral Decimal and tax contracts; shared sequence persistence; versioned firm business policies; quotation calculation-policy snapshots; transactional outbox, attempts and worker lifecycle; shared PDF rendering/storage composition; in-app notification delivery, preferences and job recovery.

Inspected boundaries include `BACKEND-MODULE-RULES.md`, `BACKEND-DEPENDENCY-BOUNDARIES.md`, route registration, all files named by the specification, relevant quotation/settings callers and frontend consumers, existing migrations, and the architecture tests. No generic controller/service framework or duplicate provider was added.

Baseline evidence: backend 235 passed / 50 skipped; frontend 181 passed; backend TypeScript check passed.

## B. Plan and executed changes

The implementation followed the announced shared-primitives, additive-schema, quotation-adapter, worker, settings and validation plan. Safe recovery required notification job inspection/retry endpoints. The misleading quotation reset control is now read-only; changing its behavior requires another approved cutover. Revision copies with no historical policy snapshot are explicitly marked unversioned instead of claiming a newly inferred historical rounding policy.

Paths in the following table are relative to their checkout. Every created or edited source, migration, test and documentation file is listed.

| Checkout / file | Change | Purpose and reused implementation |
| --- | --- | --- |
| backend `prisma/schema.prisma` | Edited | Six infrastructure models, outbox status enum, firm relations and nullable quotation policy snapshot; retains domain document histories. |
| backend `prisma/migrations/20261027090000_wave03_business_infrastructure/migration.sql` | Added | Additive tables/constraints and collision-safe legacy sequence seed using existing quotation/settings data. |
| backend `src/core/money/money.ts` | Added | Isolated Decimal precision, explicit minor units/rounding, currency-safe addition and FX provenance; reuses Prisma Decimal. |
| backend `src/core/money/index.ts` | Added | Narrow money exports. |
| backend `src/core/tax/tax-policy.ts` | Added | Versioned explicit India GST/no-tax arithmetic over shared money; jurisdiction/rate determination remains domain-owned. |
| backend `src/core/tax/index.ts` | Added | Narrow tax exports. |
| backend `src/core/sequences/document-sequence.ts` | Added | Native MySQL atomic reservation and UTC reset-period calculation in the owning transaction. |
| backend `src/core/sequences/index.ts` | Added | Narrow sequence exports. |
| backend `src/core/outbox/outbox.types.ts` | Added | Handler authorization/execution and retry capability contracts. |
| backend `src/core/outbox/outbox.repository.ts` | Added | Enqueue idempotency, durable claims, leases, attempts, retries, dead letters, reconciliation state and required audits. |
| backend `src/core/outbox/worker.ts` | Added | Single in-flight polling cycle, safe error logging and shutdown drain. |
| backend `src/core/outbox/index.ts` | Added | Narrow outbox exports. |
| backend `src/integrations/documents/document-renderer.ts` | Added | Composes existing PDF and storage providers; hashes output and cleans partial writes. |
| backend `src/integrations/documents/index.ts` | Added | Narrow rendering export. |
| backend `src/modules/auth/auth.worker.ts` | Added | Reloads current actor, firm and role; reuses active-user, firm-access and permission helpers. |
| backend `src/modules/auth/index.ts` | Edited | Exposes the narrow worker authorization helper. |
| backend `src/modules/notifications/notifications.repository.ts` | Added | Typed in-app enqueue/dispatch, live resource and recipient ownership checks, preferences and scoped inbox read. |
| backend `src/modules/notifications/jobs.repository.ts` | Added | Firm-scoped delivery diagnostics and authorized retry of dead transactional notification jobs. |
| backend `src/modules/notifications/notifications.routes.ts` | Added | Authenticated inbox and permission-protected job routes using existing firm context and API responses. |
| backend `src/modules/notifications/index.ts` | Added | Explicit notification router and delivery exports. |
| backend `src/modules/settings/business-policy/business-policy.schema.ts` | Added | Strict supported currencies, rounding and versioned tax policy validation. |
| backend `src/modules/settings/business-policy/business-policy.repository.ts` | Added | Typed resolver and append-only policy versions; optimistic version check, firm locking, required audit and atomic notification trigger. |
| backend `src/modules/settings/settings.routes.ts` | Edited | Narrow GET/PUT business-policy endpoints with existing profile permission. |
| backend `src/modules/settings/index.ts` | Edited | Exposes the policy resolver through the existing module boundary. |
| backend `src/modules/settings/settings.audit.ts` | Edited | Accepts transaction clients and explicit required-audit policy. |
| backend `src/modules/settings/quotation-settings/quotation-settings.schema.ts` | Edited | Bounds legacy sequence edits to the existing signed integer field capacity. |
| backend `src/modules/settings/quotation-settings/quotation-settings.repository.ts` | Edited | Reads authoritative shared sequence; serializes edits, prevents rewinds/reset changes, and commits required audit with updates. |
| backend `src/modules/quotations/calculations/quotation-policy.ts` | Added | Captures actual current quotation calculation rules without applying future-domain settings. |
| backend `src/modules/quotations/calculations/quotation-calculations.ts` | Edited | Uses shared explicit half-up grand-total rounding; preserves existing algorithm and golden results. |
| backend `src/modules/quotations/numbering/quotation-number.ts` | Edited | Uses shared reservations, firm-owned settings lock, historical collision check and number length guard. |
| backend `src/modules/quotations/quotations.repository.ts` | Edited | Stores policy snapshots on calculated creates/edits and copies known revision policies; marks unknown historical policies explicitly. |
| backend `src/modules/quotations/documents/quotation-document.template.ts` | Edited | Formats stored amounts with Decimal while preserving legacy two-place display. |
| backend `src/modules/quotations/documents/quotation-documents.routes.ts` | Edited | Uses shared renderer while retaining quotation access, templates, file paths, history, quota and cleanup ownership. |
| backend `src/config/env.ts` | Edited | Validates opt-in worker enablement and polling interval. |
| backend `src/bootstrap/outbox-worker.ts` | Added | Composes the registered module handler with the neutral worker; no business imports in core/integrations. |
| backend `src/bootstrap/server.ts` | Edited | Starts opt-in worker and drains it before Prisma disconnect; makes signal shutdown idempotent. |
| backend `src/bootstrap/registerRoutes.ts` | Edited | Registers the notification module. |
| backend `tests/money-tax.test.ts` | Added | Precision, minor units, rounding goldens, explicit FX and GST/no-tax fixtures. |
| backend `tests/document-sequence.test.ts` | Added | UTC/reset contracts and exact large-integer reservation. |
| backend `tests/document-renderer.test.ts` | Added | Existing provider composition, renderer crash, partial storage write and recoverable retry. |
| backend `tests/outbox.test.ts` | Added | Rollback-capable dispatch fixture, concurrent claim, expired lease, poison event, idempotent external effect, uncertain delivery, audit failure and shutdown. |
| backend `tests/business-policy.test.ts` | Added | Typed defaults, unsupported settings, version conflicts, access denial, required audit and module-owned trigger. |
| backend `tests/notifications.test.ts` | Added | Actor/role/firm revocation, foreign resources and recipients, poison payloads, entitlement checks and preferences. |
| backend `tests/wave03.mysql.test.ts` | Added | Opt-in disposable-MySQL concurrency, rollback, historical backfill continuity and two-firm notification contracts. |
| backend `tests/quotation-number.test.ts` | Edited | Verifies shared allocator ownership, historical collision skips and foreign settings denial. |
| backend `tests/settings.repository.test.ts` | Edited | Shared counter reads, forward edits, rewind/reset denial and required audit failure; updated transaction fixtures. |
| backend `tests/quotations.repository.test.ts` | Edited | Updated sequence fixture and explicit unknown historical revision-policy assertion. |
| backend `tests/quotation-documents.template.test.ts` | Edited | Exact Decimal formatting regression. |
| backend `tests/quotations.mysql.test.ts` | Edited | Verifies shared sequence rollback and cleans new sequence records. |
| backend `tests/helpers/two-firm-fixture.ts` | Edited | Supports guarded Wave 03 test URLs and cleans infrastructure records in dependency order. |
| backend `docs/architecture/backend/WAVE03-IMPLEMENTATION-REPORT.md` | Added | Inventory, implementation, migration/recovery, ownership and actual validation record. |
| frontend `src/features/settings/api/business-policy.api.ts` | Added | Typed policy GET/PUT through existing tenant-aware API client. |
| frontend `src/features/settings/components/BusinessPolicyPanel.tsx` | Added | On-demand settings editor with explicit scope, validation, version conflict recovery and notification preference. Preserves edits across panel close/reopen. |
| frontend `src/features/settings/components/BusinessPolicyPanel.test.tsx` | Added | Load/save/conflict/retry and unsaved-edit retention. |
| frontend `src/features/settings/pages/BusinessSettingsPage.tsx` | Edited | Adds the separate policy panel outside the existing business-profile form. |
| frontend `src/features/settings/pages/QuotationSettingsPage.tsx` | Edited | Makes the legacy reset control read-only and explains continuous numbering. |
| frontend `src/features/settings/model/quotation-settings.schema.ts` | Edited | Matches the backend's database integer bound for manual sequence edits. |
| frontend `src/features/settings/settings.test.tsx` | Edited | Adds the corresponding sequence upper-bound validation assertion. |

No package manifests or dependency locks changed. Prisma Client was regenerated in the existing parent `node_modules` for validation. The first generation attempt encountered the workspace write boundary; the same client-generation action succeeded with sandbox approval. It did not contact a database.

## C. Database migration and recovery

The migration adds `DocumentSequence`, `FirmBusinessPolicy`, `OutboxEvent`, `JobAttempt`, `NotificationPreference`, `NotificationDelivery`, `OutboxStatus`, and nullable `Quotation.financialPolicySnapshot`. Existing records, totals, numbers, PDFs and communication histories are not rewritten. Unknown historical quotation policies are not backfilled with an invented policy.

Sequence uniqueness is `(firmId, documentType, period)`. Policy versions are unique by firm/version. Outbox idempotency is unique by firm/key; attempt numbers are unique by event/attempt. Inbox delivery is unique by event/recipient. Composite event/firm ownership is enforced for notification deliveries. Firm foreign keys restrict deletion. Worker and recipient identities are reloaded and authorized at execution time.

The seed chooses the greater of the saved next quotation number and one above the largest numeric historical suffix, including deleted records and revisions. All legacy quotation reservations use `QUOTATION / LEGACY`. The old settings field remains a seed/compatibility mirror, while the shared table owns allocation and returned settings values. New document types can explicitly use never, calendar-year or configurable financial-year periods.

Cutover procedure, not executed: pause all writers; confirm strict SQL mode and inspect high-water marks; apply the additive migration; deploy matching application code; verify sequence continuity before reopening writes. Do not run old and new allocators together. An oversized historical suffix must be investigated rather than truncated. MySQL DDL is not fully transactional; a partially applied migration needs an inspected forward fix.

Recovery favors forward fixes and retained infrastructure records. Do not downgrade to the old allocator while its seed is stale. If a rollback is approved, pause writers, reconcile each legacy seed to at least the shared next value and historical high-water mark, then change application versions. Never drop outbox/attempt or issued policy evidence as an automatic rollback.

Migration SQL was reviewed and the Prisma schema validates. Migration execution, backfill behavior, database locks and actual concurrent MySQL writes remain NOT RUN.

## D. API, authorization and ownership

| API or boundary | Feature / permission | Ownership |
| --- | --- | --- |
| GET/PUT `/api/v1/settings/business-policy` | `firm.core` + `firm.profile.manage` | Server-resolved firm; strict request schema; updates reload actor and entitlement inside firm-locked transaction. |
| GET `/api/v1/notifications` | Active authenticated account, completed password change, active selected firm and `firm.core` | Both firm and recipient are server-derived. Returns only own inbox. |
| GET `/api/v1/notifications/jobs` | `firm.core` + `firm.profile.manage` | Only selected firm's in-app notification jobs; excludes payloads. |
| POST `/api/v1/notifications/jobs/:id/retry` | `firm.core` + `firm.profile.manage` | Firm-scoped UUID; only DEAD in-app jobs; revalidates current and originating actors and owned resources. |
| Internal notification worker | Originating actor permission, current firm/role and `firm.core` | Durable event firm/actor; checks owned policy version and active same-firm recipient before any effect. |
| Quotation PDF flow | Existing `quotations.documents` and permission/quota behavior | Quotation module retains access checks, protected path creation, domain template and document history. |
| Shared sequence | Owning module's authorized transaction | Firm/type/period key; no public reservation endpoint. |
| Money/tax primitives | Owning module's typed flow | No generic public execution or calculation API. |

No new subscription feature keys or quota resources were invented. In-app metadata delivery has no quota debit. Existing document/storage quota enforcement remains in the quotation repository. Existing entitlement tests cover plan, role, hard-disable, expired override, firm status and quota combinations; actual database quota/isolation suites remain pending.

## E. Completed features and acceptance mapping

| Specification feature | Implemented scope | Acceptance state |
| --- | --- | --- |
| 2.1 Money | Explicit Decimal inputs, isolated precision, supported currency scales, rounding, currency-safe addition and provenance-bearing conversion. | Unit fixtures PASS. |
| 2.2 Tax | Version 1 no-tax and explicitly selected INR India GST arithmetic; no jurisdiction inference or compliance claim. | Fixtures PASS; other regimes unsupported. |
| 2.3 Sequences | Transactional shared allocator and legacy quotation adapter/backfill; explicit reset-period helper. | Unit PASS; MySQL concurrency/cutover BLOCKED on deferred database verification. |
| 2.4 Rendering | Existing PDF/storage composition and unchanged mail integration; domain templates/access/history remain owned by modules. | Provider fault and quotation regressions PASS; live provider contracts NOT RUN. |
| 2.5 Outbox/jobs | Atomic originating write/enqueue, claims, leases, attempts, actor/resource revalidation, retries, dead letters, audits and shutdown. | Simulation PASS; real MySQL delivery/concurrency NOT RUN. |
| 2.6 Notifications | Transactional in-app delivery, preferences, own inbox and authorized dead-job recovery; triggers remain Settings-owned. | Unit/UI PASS; live MySQL contracts NOT RUN. |
| 2.7 Configuration | Strict versioned policy resolver, safe explicit defaults, optimistic updates and separate settings UI. | Unit/UI PASS. |

Section 11 boundaries pass the architecture suite. Existing quotation calculation, PDF, email, settings and frontend regressions pass. Shared reservations for separate invoice/quotation types are implemented, but their actual MySQL concurrency proof is pending. Failure states and retry controls are implemented and tested in rollback-capable simulations. Tax selection is explicit and versioned.

Automatic SMTP/PDF background dispatch is NOT IMPLEMENTED and is outside the approved retry scope. Existing synchronous quotation actions remain available. An SMTP timeout or process crash cannot prove that a message was not accepted; SMTP is not registered as an idempotent retry handler. Future non-idempotent handlers use RECONCILE, and the public retry endpoint cannot release such jobs.

## F. Actual validation

Commands were run directly through existing workspace binaries; no npm/pnpm/yarn invocation, installation, build, lint, format, Git, Docker, migration or deployment command ran. Testing was expressly authorized by the user. Database testing was subsequently explicitly deferred by the user.

| Working directory | Exact command | Result |
| --- | --- | --- |
| backend | `../node_modules/.bin/vitest run` | PASS: 40 files, 277 tests; 4 database files / 55 tests skipped. |
| frontend | `../node_modules/.bin/vitest run` | PASS on final full run: 39 files, 186 tests. |
| backend | `../node_modules/.bin/tsc --noEmit` | PASS, exit 0. |
| frontend | `../node_modules/.bin/tsc --noEmit` | PASS, exit 0. |
| backend | `../node_modules/.bin/prisma validate --schema prisma/schema.prisma` | PASS: schema is valid. |
| backend | `../node_modules/.bin/prisma generate --schema prisma/schema.prisma` | PASS after sandbox approval; client generation only. |
| backend | `python3 -m unittest discover -s tests -p 'test_*.py'` | PASS: 1 test. |
| backend | `../node_modules/.bin/vitest run tests/money-tax.test.ts` | PASS: 6 tests. |
| backend | `../node_modules/.bin/vitest run tests/settings.repository.test.ts tests/quotation-number.test.ts tests/quotations.repository.test.ts tests/money-tax.test.ts tests/architecture/dependency-boundaries.test.ts` | Initial fixture-adaptation run: 4 failures; updated fixtures and later full suite PASS. |
| backend | `../node_modules/.bin/vitest run tests/outbox.test.ts tests/money-tax.test.ts tests/document-sequence.test.ts tests/document-renderer.test.ts tests/quotation-number.test.ts tests/settings.repository.test.ts tests/quotations.repository.test.ts tests/architecture/dependency-boundaries.test.ts` | PASS: 64 tests at that point in development. |
| backend | `../node_modules/.bin/vitest run tests/business-policy.test.ts tests/settings.repository.test.ts tests/outbox.test.ts tests/quotation-calculations.test.ts` | PASS: 32 tests at that point in development. |
| backend | `../node_modules/.bin/vitest run tests/notifications.test.ts tests/wave03.mysql.test.ts` | PASS: 10 tests; 5 MySQL tests skipped. |
| frontend | `../node_modules/.bin/vitest run src/features/settings/components/BusinessPolicyPanel.test.tsx src/features/settings/settings.test.tsx` | PASS: 18 tests before the final edit-retention test was added. |
| frontend | `../node_modules/.bin/vitest run src/features/settings/settings.test.tsx src/features/settings/components/BusinessPolicyPanel.test.tsx` | PASS: latest run 19 tests, including final sequence-bound validation and edit retention; earlier run 18 tests. |

Final output excerpts:

```text
Backend:  Test Files 40 passed | 4 skipped (44)
          Tests 277 passed | 55 skipped (332)
Frontend: Test Files 39 passed (39)
          Tests 186 passed (186)
Final focused frontend recheck: 2 files, 19 tests passed
Python:   Ran 1 test ... OK
Prisma:   The schema at prisma/schema.prisma is valid
```

One full frontend run while both test suites and compiler checks ran concurrently failed the existing one-second business-settings hydration wait: 184 passed, 1 failed. The focused settings suites and subsequent complete frontend run passed. Test timeouts and unrelated application code were not changed to suppress this result. Resource contention is a plausible explanation, not a proven root cause of that transient failure.

Coverage includes Decimal/rounding goldens, GST/no-tax, provider crashes/partial writes, recoverable retry, idempotent external effect after failed commit, duplicate claims, poison events, lease recovery, uncertain delivery reconciliation, mandatory audit rollback, revoked roles/firm status, foreign resource/recipient IDs, version conflicts, and original quotation regressions.

NOT RUN: all 55 opt-in MySQL tests, including the five new Wave 03 contracts. No local disposable database URL was configured, and the user explicitly selected leaving database tests pending. The new suite requires a local `wave03_test_<suffix>` database with the schema already applied and `WAVE03_TEST_DATABASE_URL` set. It never falls back to application `DATABASE_URL`, never applies DDL, and scopes its backfill DML to newly created owned fixtures. Also NOT RUN: external PDF/SMTP sandbox contracts and real provider acceptance/recovery, builds and lint.

## G. Risks, decisions and readiness

The user approved preservation of quotation math, explicit GST/no-tax selection, continuous quotation numbering at cutover, an opt-in local MySQL worker, and automatic retry only for safe effects. No further production deployment or database mutation was authorized.

Known risks and limits:

- Actual MySQL lock/concurrency/backfill behavior and full cross-tenant database regressions are unverified until the deferred suites run.
- Deployment must pause legacy writers and avoid mixed allocators. Do not treat the retained legacy seed as current after normal allocations.
- SMTP has no exactly-once guarantee. Safe automatic SMTP retry requires a separately approved idempotent provider or an explicit reconciliation workflow.
- Old quotation policies remain unknown where no snapshot exists. Existing amounts are preserved; copied revisions mark that uncertainty.
- New business policy settings intentionally apply to future financial workflows. Existing quotation defaults and totals keep their existing semantics.
- Other tax regimes and currencies outside the explicit supported list fail closed. The GST adapter performs supplied arithmetic, not legal tax determination.
- The transient frontend hydration timeout remains an observed test-run limitation; the final full suite passed.

Architecture validation confirms that core/integrations do not depend on business modules. Sequence allocation and PDF provider composition have one shared implementation. New APIs use existing authorization, tenancy, error and response conventions. Original quotation suites pass. Required business-policy, outbox and sequence-setting audit writes participate in their database transactions. No temporary diagnostic logs, new vendor, invoice/payment business table or unrequested workflow engine was added.

Recommendation: implementation is ready for code review. NO-GO for production cutover or accepting the next financial wave until disposable-MySQL migration/backfill/concurrency/isolation verification succeeds and the normal deferred build/lint gates run. Keep `OUTBOX_WORKER_ENABLED=false` until schema application and transactional verification are complete. For an approved local worker after those gates, set `OUTBOX_WORKER_ENABLED=true`; `OUTBOX_POLL_INTERVAL_MS` defaults to 1000 and is validated between 100 and 60000.
