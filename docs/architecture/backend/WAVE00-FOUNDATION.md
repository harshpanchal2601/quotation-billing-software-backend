# Wave 00 Foundation Stabilization

Wave 00 corrects currency reporting, quotation numbering contention, and transactional quotation history using the existing repositories, settings, Prisma models, and providers. Source changes and regression suites are prepared. Runtime acceptance remains pending because the user's chat instructions explicitly defer Git, package-manager, build, test, lint, format, installation, migration, container, and deployment commands.

The supplied implementation document is a proposed specification. Its embedded permission to execute commands does not override the chat restrictions. No production data, environment-file contents, credentials, external email, or deployed configuration was accessed or changed.

## A Baseline inventory

| Repository | Branch | Commit read directly from local reference |
| --- | --- | --- |
| Backend | `feat/wave1` | `f7bc2549617c75460f2267bfe9d1c03097bc7f5f` |
| Frontend | `feat/wave1` | `410a6ed744439a0cd34c1093e719d832e9da9505` |

Git status and diff were not executed. These reference values do not establish a clean working tree or isolate pre-existing uncommitted edits. The implementation scope is Wave 00 despite the existing branch names.

[`WAVE00-INVENTORY.json`](WAVE00-INVENTORY.json) records all 102 discovered route declarations, including three branding asset expansions, 24 Prisma models, 21 permission keys, four migration files, and 69 current test files. Route entries include source locations, declared permissions, router guards, and inherited quotation guards. These are static declarations rather than runtime authorization results.

`../Archive.zip`, relative to the backend, exists. Its schema, both package manifests, route registration, quotation route declarations, and tenant-context middleware match the current files byte for byte. A full archive-to-working-tree provenance comparison was not performed. The archive contains `backend/.env`, `frontend/.env`, and their two example files; only entry names were inspected.

| Capability | Baseline state | Evidence and Wave 00 treatment |
| --- | --- | --- |
| Authentication and sessions | Present | `src/modules/auth`, `AuthSession`, auth route/middleware/cookie tests; reused unchanged |
| Firms and custom roles | Present | `Firm`, `FirmRole`, platform/administration routes, tenant context, permission middleware; no new tenancy model |
| Companies and nested contacts/addresses | Present | Companies routes/repositories; quotation snapshots validate company ownership and nested IDs |
| Item catalog and units/categories | Present | Items, categories, measurement units, image policy and their existing tests; reused unchanged |
| Settings and branding | Present | Business profile, bank details, quotation settings and branding routes; numbering reuses the public settings helper |
| Quotation financial calculations | Present with verified wording defect | Existing Decimal engine always produced Rupees; currency now reaches preview/create/update wording |
| Quotation revisions and snapshots | Present | Existing revision families, versions and stored amount wording; copied without recalculation during revision creation |
| Status/history/audit | Partially consistent | Manual status updates were separate writes; critical audit failures were swallowed; now transaction-owned and required |
| Number allocation | Present with race | Read/check/write sequence could reserve the same number; now an atomic increment within the create transaction |
| Reset rules | Exposed but not implemented | Settings expose `FINANCIAL_YEAR`, `CALENDAR_YEAR`, `NEVER`; user explicitly deferred reset behavior |
| Dashboard | Present with verified aggregation defect | All currencies were summed under default-currency label; corrected contract below |
| PDF, attachments, communications | Present | Existing PDF/storage/mail integrations and document history; email status race corrected without replacing providers |
| Import tables and terms templates | Schema present | `ImportBatch`, `ImportRow`, `TermsTemplate` exist; schema presence does not prove an exposed workflow |
| Subscriptions, entitlements, AI, invoices, inventory | Excluded from this wave | No new feature gates, quota framework, or domain models introduced |
| Test baseline | Source inventory present; execution pending | Existing architecture, tenant, role, quotation, provider and frontend tests retained; focused regressions added |

### Proven affected flows

Quotation form edits start a debounced `POST /api/v1/quotations/calculate`. The frontend API unwraps `response.data.data`; successful totals become the form's preview state and feed the totals display. Previously currency was absent from the preview payload and calculation input, and the backend word converter always appended Rupees. Create/update also omitted currency from calculation calls despite storing it on quotations. Currency now travels through each path, and a currency edit invalidates the preview request key.

The dashboard page requests `GET /api/v1/dashboard/overview`; its API unwraps `response.data.data`, React Query stores the overview keyed by the full query, and cards/trends/status/customer sections format aggregates with `data.currency`. Previously every quotation's `grandTotal` entered those aggregates regardless of currency. The repository now segments totals and scopes monetary aggregates to the selected currency before serialization. Individual recent/expiring rows retain their stored currencies.

Manual status mutation validates the firm-owned current revision, then conditionally updates its observed status and timestamp in the same transaction as history and required audit. A zero-row update raises 409 before history is written. Draft edit, revision creation and deletion now use equivalent state predicates so those paths cannot bypass a concurrent status change. Draft edits advance their concurrency timestamp even within the same millisecond. Email re-reads after SMTP acceptance and conditionally changes only the current latest draft/pending revision. A conflicting change produces no fabricated email status history.

## B Change plan and executed files

No dependencies or business-domain models were added. The original plan was extended to guard draft edits, revision creation and deletion after tracing their shared quotation state. It also includes an explicit post-SMTP persistence error because provider acceptance cannot be rolled back.

All paths below are relative to the Bhuminex workspace parent.

| File | Change and reason | Existing implementation reused |
| --- | --- | --- |
| `backend/src/core/audit/audit-log.service.ts` | Add explicit required/best-effort policy; required failures propagate | Existing audit writer and metadata shape |
| `backend/src/modules/quotations/calculations/quotation-calculations.ts` | Currency-aware wording with Decimal rounding and international grouping | Existing tax, discount, charge, rounding and INR wording engine |
| `backend/src/modules/quotations/quotations.types.ts` | Add optional preview currency | Existing calculation contract |
| `backend/src/modules/quotations/quotations.schema.ts` | Validate/default preview currency like quotation currency | Existing Zod schemas |
| `backend/src/modules/quotations/numbering/quotation-number.ts` | Atomically reserve settings sequence; use UTC date-only year boundaries | Existing sequence row and quotation-number format |
| `backend/src/modules/quotations/quotation-status.ts` | Accept transaction clients for history persistence | Existing transition matrix/history helper |
| `backend/src/modules/quotations/quotations.repository.ts` | Pass currency; transaction-own required audits; guard competing writes; initialize settings before transaction | Existing snapshots, versions, revision families and firm filters |
| `backend/src/modules/quotations/communications/quotation-communications.repository.ts` | Re-read and guard email status transition; require transactional audits; explain irreversible provider acceptance on persistence failure | Existing SMTP lifecycle, communication model and provider |
| `backend/src/modules/dashboard/dashboard.repository.ts` | Segment totals and scope money/averages/rankings by currency while preserving overall counts | Existing Decimal repository aggregates |
| `backend/src/modules/dashboard/dashboard.schema.ts` | Add optional three-letter currency query | Existing overview query schema |
| `backend/src/modules/dashboard/dashboard.types.ts` | Add currency query and grouped currency totals | Existing DTO fields remain |
| `backend/tests/audit-log.test.ts` | Add required failure and best-effort compatibility regressions | Vitest and existing audit writer |
| `backend/tests/quotation-calculations.test.ts` | Add exact INR/USD/AED/SAR/unknown-code wording and large-value goldens | Existing calculation engine |
| `backend/tests/quotation-number.test.ts` | Add atomic reservation, occupied number and UTC boundary checks | Existing numbering helper |
| `backend/tests/quotations.repository.test.ts` | Update transactional fixtures; add conflict, failure propagation and foreign-ID checks | Existing repository fixtures |
| `backend/tests/dashboard.repository.test.ts` | Add mixed-currency aggregates and unchanged volume checks | Existing dashboard test suite |
| `backend/tests/quotation-communications.repository.test.ts` | Add SMTP race and mandatory persistence-failure cases | Existing mocked SMTP/storage lifecycle |
| `backend/tests/quotations.mysql.test.ts` | Add opt-in numbering contention, terminal races, rollback and two-firm fixtures | Real Prisma transactions and existing repositories |
| `backend/tests/test_source_archive.py` | Add secret/private-file and symlink exclusion coverage | Python standard library fixtures |
| `backend/scripts/export-source-archive.py` | Add exclusive source ZIP export using allowed source directories and secret/runtime exclusions | Python standard library; no storage provider duplication |
| `backend/.gitignore` | Ignore environment variants, keys and private/archive files | Existing ignore policy |
| `backend/.gitattributes` | Exclude private/runtime material from future committed source archives | Git export attributes; no Git command executed |
| `backend/docs/architecture/backend/WAVE00-INVENTORY.json` | Record route/model/permission/test/migration inventory | Current source declarations |
| `backend/docs/architecture/backend/WAVE00-FOUNDATION.md` | Record findings, contracts, validation gaps and operational decisions | Existing backend architecture documentation |
| `frontend/src/features/quotations/model/quotations.types.ts` | Add optional preview currency | Existing client contract |
| `frontend/src/features/quotations/model/quotations.utils.ts` | Carry currency into preview payload | Existing payload builder |
| `frontend/src/features/quotations/components/QuotationForm.tsx` | Recalculate preview when currency changes | Existing debouncing and stale-response guards |
| `frontend/src/features/quotations/quotations.test.tsx` | Assert preview currency and currency-change recalculation | Existing form test helpers |
| `frontend/src/features/dashboard/model/dashboard.types.ts` | Mirror additive backend currency contract | Existing overview types |
| `frontend/src/features/dashboard/pages/DashboardPage.tsx` | Add URL-backed currency selector and explain value/count scope | Existing query keys, period controls and cards |
| `frontend/src/features/dashboard/dashboard.test.tsx` | Update fixture and verify selected currency request | Existing dashboard RTL harness |
| `frontend/.gitignore` | Ignore environment variants, keys and private/archive files | Existing ignore policy |
| `frontend/.gitattributes` | Exclude private/runtime material from future committed source archives | Git export attributes |

## C Database boundaries and recovery

Schema diff: none. Migration files: none added or executed. No sequence backfill, historical recalculation, renumbering, PDF rewrite, or data migration is part of this change.

The existing unique constraints remain authoritative: `(firmId, quotationNumber, revisionNumber)`, `(firmId, rootQuotationId, revisionNumber)`, and unique `previousRevisionId`. `QuotationSetting` remains unique per business profile, which is unique per firm. The settings-row increment serializes reservations; the existing database uniqueness constraint still protects inserts. Quotation creation failure rolls the reservation back with the quotation, initial history, version and required audit.

Allocation still checks up to five occupied candidates, including historical/deleted records, and fails closed on exhaustion. Correcting a manually lowered legacy sequence is an operator decision; this wave does not silently backfill it. Financial-year formatting remains April–March, using stored UTC quotation dates. The existing sequence continues across years as explicitly requested. The exposed reset-rule setting remains a documented limitation.

For a source rollback, restore the prior application revision without changing persisted numbers, statuses, snapshots, versions, audit records or generated files. Do not decrement sequences or delete audit/history records to simulate rollback. Such an application rollback reintroduces the original defects and requires restricted quotation writes until a forward fix is deployed. There is no SQL rollback to execute. Deploy the additive backend dashboard contract before its frontend consumer.

## D API authorization and ownership

`/api/v1/quotations` route paths, success envelopes, status matrix and permission keys remain stable. Preview adds an optional currency, defaulting to INR for existing clients. New create/update calculations use their effective quotation currency. Existing serialized amount wording is read from storage; revision creation copies it. Existing PDF files are not touched.

The dashboard overview accepts optional `currency=USD` (or another three-letter code). Its additive `currencyTotals` array contains `{currency, quotationCount, totalQuotationValue}` for each currency in the requested period. Existing scalar monetary fields, status values, monthly values and customer rankings use the returned `currency`, defaulting to the firm's configured currency. Counts in overall metrics/status/monthly series remain across currencies. Average divides only by the selected currency's quotation count; top-customer counts belong to that currency's ranked quotations. An absent currency has zero monetary values and an empty ranking. No exchange rates or conversion are implied.

| Domain and API | Authorization | Ownership |
| --- | --- | --- |
| Auth login/refresh/logout/me/change-password | Existing authentication/session rules | User/session; platform and firm identities retained |
| Platform firms and administrator reset | `SUPER_ADMIN` account guard | Platform-wide deliberate administration |
| Firm administration users/roles | Existing `firm.users.manage`, `firm.roles.manage` | Active selected/assigned firm |
| Settings profile/branding/bank/quotation | Existing profile, bank and quotation-settings permission keys | Business profile belongs to firm; settings/banks inherit profile |
| Companies/contact/address/history | `companies.view` or `companies.manage` | Company has firm; nested IDs validated against selected company |
| Items, categories, units | Existing item/catalog view/manage keys | Direct firm ownership; item master checks retained |
| Quotation list/detail/create/edit/status/delete/revisions | Existing `quotations.*` keys per route | Server-resolved firm plus quotation ID and latest-revision/state guards |
| Quotation PDF, attachments and email/history | Existing document/attachment/email keys | Quotation ownership first; nested file/communication IDs belong to quotation |
| Dashboard overview | `dashboard.view` | Every changed query remains firm-filtered |
| Audit history | `audit.view` | Direct firm filter; changed quotation audits derive firm from server context |
| Health and database health | Existing public health routes | Operational endpoints; unchanged |

Full endpoint and permission declarations are in the JSON inventory. Existing permission middleware uses its established any-of semantics where multiple keys are passed. Authentication and active-firm context remain inherited by quotation capability routers. Entitlement, subscription override and business quota gates are not added in Wave 00. Existing firm user limits remain unchanged.

Direct firm-owned models are `User`, `BusinessProfile`, `Company`, `ItemCategory`, `MeasurementUnit`, `Item`, `Quotation`, `TermsTemplate`, `ImportBatch`, and `AuditLog`; user/audit firm association can be nullable for platform activity. `FirmRole` also belongs directly to a firm. `BankDetail` and `QuotationSetting` inherit through `BusinessProfile`. Contacts/addresses inherit through `Company`; items have catalog/unit relationships. Quotation items/status histories/versions/attachments/documents/communications inherit through `Quotation`. `ImportRow` inherits through `ImportBatch`; `AuthSession` through `User`. `Firm` is the tenant root.

## E Feature and acceptance mapping

| Specification item | Source outcome | Acceptance state |
| --- | --- | --- |
| 2.1 Baseline inventory | Inventory/register added; existing implementations and limitations separated | Static inventory complete; full runtime audit and clean-tree provenance NOT VERIFIED |
| 2.2 Financial calculation integrity | INR preserved; USD/AED/SAR named; other accepted codes remain explicit; dashboard segmented | Implemented in source; golden and mixed-currency tests NOT RUN |
| 2.3 Sequence correctness | Atomic settings-row reservation and UTC formatting; no renumbering | Implemented; MySQL contention NOT RUN; resets DEFERRED by user |
| 2.4 Atomic state history | Manual and email transitions guard current state; quotation critical writes require transactional audit | Implemented; race/rollback suites NOT RUN |
| 2.5 Security and secrets | Future export exclusions and rotation procedure | Implemented in source; existing archive remains sensitive; credential rotation NOT PERFORMED |
| 2.6 Test baseline | Regression sources and opt-in MySQL suite prepared | NOT RUN under chat restriction; pre-existing failures unknown |
| 2.7 Backward compatibility | Existing quotation fields/history/providers retained; dashboard additive fields with documented corrected money semantics | Source review complete; full serialization/PDF/role/tenant regressions NOT RUN |
| 11 Findings register | This report and JSON inventory | Present |
| 11 No duplicate models/services | No new domain model, provider or calculation engine | Source review complete; architecture suite NOT RUN |
| 11 No fabricated currency totals | Monetary aggregates select exactly one currency; grouped totals available | Source implementation complete; runtime NOT VERIFIED |
| 11 Unique numbers under contention | Disposable MySQL regression added | NOT RUN |
| 11 Required audit gates transitions | Required failures escape owning transaction | Source implementation complete; database rollback NOT VERIFIED |
| 11 Reproducible checks | Commands/prerequisites documented below | Execution pending; no skipped check reported passing |

User decisions: support INR, USD, AED and SAR; preserve whole-unit rounding; keep the existing sequence and defer reset changes. Non-INR wording uses international number grouping. INR wording keeps the existing lakh/crore convention, including existing Rupees wording. Other already accepted codes are printed explicitly rather than mislabeled as Rupees. No new fractional-unit, GST, freight-tax or other-charge tax policy was introduced.

## F Validation evidence and deferred commands

Executed work was limited to file reads/searches, ZIP entry inspection and selected non-secret source comparisons, source/document edits, and static inventory generation. No typecheck, lint, build, test, Prisma validation/diff, database operation, package installation, Git operation, container or deployment command ran. No pre-change failing-test output exists, and no post-change pass is claimed.

| Check | Outcome and prerequisites |
| --- | --- |
| Backend and frontend typecheck/lint/unit/build | NOT RUN; requires explicit release of chat command restrictions and existing local dependencies |
| Architecture boundaries | NOT RUN; existing `tests/architecture/dependency-boundaries.test.ts` retained |
| Calculation goldens | NOT RUN; new `tests/quotation-calculations.test.ts` covers four named currencies, unknown code, zero/singular and large exact values |
| Dashboard segmentation | NOT RUN; repository fixture checks INR/USD aggregates, counts, status/month/customer outputs and firm predicates |
| Status conflicts and required audit | NOT RUN; mocks cover conflict/failure propagation; mocks do not prove database rollback |
| Real numbering/races/rollback | NOT RUN; opt-in MySQL suite requires explicitly provisioned local disposable database with current schema |
| Two-firm probes | NOT RUN; new real-database read/list/status/foreign-company cases plus existing tenant tests; exhaustive export/download/nested-ID/audit/timing matrix remains NOT IMPLEMENTED |
| Role and suspended-firm checks | NOT RUN; existing auth middleware and tenant-context suites retained |
| Subscription/override/quota cases | NOT APPLICABLE to excluded Wave 02 features; no claim of entitlement enforcement |
| Frontend selectors and preview | NOT RUN; dashboard currency and quotation currency-change regressions added |
| Legacy serialization/revision/PDF | NOT RUN; existing quotation/document tests retained; historical bytes not rewritten |
| Source export policy | NOT RUN; standard-library regression covers environment/private/key/symlink exclusions |
| Provider sandbox/browser flows | NOT RUN; no external email or live-provider checks authorized/executed |

Commands below are a future validation checklist, not an execution transcript. Run package commands in each named repository only after authorization:

```text
backend: npm run typecheck
backend: npm run lint
backend: npm test
backend: npm run build
backend: npm run prisma:validate
backend: npm test -- tests/audit-log.test.ts tests/quotation-calculations.test.ts tests/quotation-number.test.ts tests/quotations.repository.test.ts tests/dashboard.repository.test.ts tests/quotation-communications.repository.test.ts tests/architecture/dependency-boundaries.test.ts
backend: python3 -m unittest discover -s tests -p test_source_archive.py
frontend: npm run typecheck
frontend: npm run lint
frontend: npm test
frontend: npm run build
```

The MySQL suite uses only `WAVE00_TEST_DATABASE_URL`, with a `mysql:` URL on loopback and a database name matching `wave00_test_<suffix>`. It never falls back to the application's `DATABASE_URL` and never runs migrations. Provision that database and apply the current schema separately under explicit authorization. With the dedicated environment value securely configured, the future command is `npm test -- tests/quotations.mysql.test.ts`. The fixture cleans only its created firm IDs. With no opt-in variable the suite is skipped; skip is not a passing contention/rollback gate. Prisma schema/migration-diff review must also be explicitly authorized and must not target production.

## G Risks decisions and operational recommendations

Wave 00 source implementation is prepared, but the next wave is NO GO until the applicable acceptance checks run and their results are reviewed. Production readiness cannot be certified from static inspection alone.

1. The existing archive contains real environment-file entries. Treat shared copies as potentially credential-bearing; the contents were not inspected and no credential compromise or rotation is claimed.
2. New required audits intentionally turn critical writes into failures when audit persistence fails. Database availability/permission failures must be repaired rather than bypassing mandatory records.
3. SMTP can accept an email before a subsequent database failure. The application returns 503 with `providerAccepted: true` and the communication ID, asks the user to check delivery before resending, and leaves failed transactional state changes rolled back. The pre-send communication attempt can remain pending. An administrator must reconcile it with provider evidence; this wave does not invent provider idempotency or automatically resend.
4. Sequence reset settings remain exposed but unused, as explicitly deferred. No historical reset/backfill policy was inferred. Collision exhaustion requires reviewing the firm's configured sequence and existing numbers before any operator correction.
5. Dashboard callers retain field names but now receive correctly currency-scoped amounts. Update consumers together with the additive backend contract; values are never exchange-rate conversions.
6. INR/USD/AED/SAR wording is English. Arabic currencies do not imply Arabic-language translation. Whole-unit rounding remains the existing policy; fractional currency naming is outside this change.
7. Test execution, full route isolation coverage, live-provider behavior and clean working-tree provenance remain unresolved validation gates, not completed achievements.

### Safe source exports

Use the prepared exporter rather than compressing the workspace wholesale. After authorization to create an archive, run `python3 scripts/export-source-archive.py --output /private/tmp/bhuminex-source.zip` from the backend. It reads both sibling repositories, excludes local environment variants, private-key patterns, credential/secret filenames, runtime storage, dependencies, hidden tool directories and symlinks, and creates the ZIP exclusively outside the repositories. It never overwrites an existing ZIP. No source archive was created during this work.

The new `.gitattributes` also excludes sensitive/runtime paths from source archives made from a revision containing those attributes. Ordinary filesystem ZIP tools do not honor Git attributes or ignore rules. Filename exclusions cannot prove the absence of secrets hardcoded inside source; review archive contents privately before sharing. Existing archives and committed history are not sanitized by these changes.

### Credential rotation procedure

1. Identify which existing archives were shared and restrict their access. Preserve incident evidence privately; do not paste environment contents into tickets, chat, tests or source files.
2. Privately inventory actual credentials in those shared copies. Include database accounts, SMTP credentials, signing material, deployment identities and provider keys only if present. Do not assume frontend environment values are private; shipped frontend configuration is public.
3. Have the responsible owner issue replacement credentials through each provider or secret manager. Limit scope to the access the application needs and coordinate signing-key/session invalidation with the authentication owner.
4. Configure replacements in the existing runtime/deployment secret stores, validate authorized environments, then revoke the old credentials. Invalidate affected sessions when signing or refresh credentials are rotated. Do not run a database migration or modify financial history as part of rotation.
5. Verify revoked credentials no longer authenticate and review provider/access logs for unexpected use. Recreate a sanitized source archive with the exporter and review it privately before redistribution.

No credential rotation, secret-store write, customer operation or deployment has been performed. No restricted commands were executed.
