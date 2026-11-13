# Wave 01 Tenant Isolation Identity and Security Boundaries

Wave 01 source changes, regression sources, a disposable MySQL harness, and a migration are prepared. Runtime acceptance is **PENDING**. No tests, typechecks, package-manager commands, Git commands, builds, linting, formatting, installs, migrations, containers, or deployment commands were executed. Source review does not establish passing tenant isolation or production readiness.

The supplied Word document establishes the requested wave scope; its embedded command authorization does not override the chat restrictions. The user confirmed Wave 00 acceptance during this implementation, preserving its deferred runtime checks. The user also approved current super-admin actions with immutable selected-firm access events, public item images and all branding, and uniquely owned disposable MySQL fixtures with scoped cleanup.

## A Baseline inventory

| Checkout | Branch | Commit read from the local branch reference |
| --- | --- | --- |
| Backend | `feat/wave2` | `99eac65a296642179c6a87579575093e5b3029a4` |
| Frontend | `feat/wave2` | `7e1786d03601dbcceb6cf3f99c57d594a0fac3ae` |

Git status and diff remain NOT RUN. These references do not prove a clean checkout or identify other uncommitted work. The existing branch names do not expand this implementation into Wave 02.

[`WAVE01-SECURITY-MATRIX.json`](WAVE01-SECURITY-MATRIX.json) records all 102 route declarations, including 89 firm routes, their current source locations and declared permission keys, and the 24 existing models and their relations. Every runtime result is explicitly NOT RUN. It updates the route declarations from the Wave 00 inventory against the current route files; it is not runtime discovery or isolation proof.

| Capability | Baseline classification | Evidence and treatment |
| --- | --- | --- |
| Firms, identities, roles, sessions | Already present | Existing `Firm`, `User`, `FirmRole`, `AuthSession`; reused without another identity model |
| Session revocation | Partially enforced | Refresh checked revocation, but `auth.middleware.ts` authenticated access tokens by user alone; fixed at shared middleware |
| Firm lifecycle | Already present | Auth helper checks user/firm status; tenant context independently checks active, undeleted firm; retained and covered in new test sources |
| Selected firm | Partially enforced | Only SUPER_ADMIN could select; ordinary headers were ignored; required access audit was missing |
| User and role ownership | Partially enforced | Schemas and repository checked roles; database role FK referenced only role ID; composite FK and identity-shape triggers prepared |
| Business ownership | Already present on traced paths | Firm-filtered companies/items/catalog/quotation/settings/dashboard repositories and parent-owned nested resources reused |
| Quotation permission composition | Incorrect | Document/attachment router-wide permission checks intercepted unrelated quotation routes; moved checks onto matching routes |
| Firm audit | Partially complete | Row list/count shared firm filter; included actor detail could belong to another scope; global platform mutations were stored in tenant scope |
| Private documents | Already protected by persisted ownership | PDF/attachment routes resolve owned quotation records; private directories excluded from static mounts; preserved |
| Attachment path confinement | Partial | String-prefix check accepted sibling directory names; replaced with a path-segment check |
| Firm-switch frontend state | Partial | Existing selectors removed queries; stale responses and auth retries could outlive selection; cancellation and context revision added |
| Integration fixtures | Newly added reusable harness | Existing Wave 00 MySQL suite established local opt-in and owned cleanup; Wave 01 adds authenticated HTTP and reusable fixture roots |
| Entitlements, workers, AI | Excluded or future contract | No Wave 02 feature/quota system, worker implementation, or AI framework introduced |

The existing `tests/auth.routes.test.ts`, `auth.middleware.test.ts`, `tenant-context.test.ts`, `quotations.repository.test.ts`, `quotation-communications.repository.test.ts`, `public-assets.test.ts`, `quotation-attachments.policy.test.ts`, settings/company/catalog/item repository suites, and `tests/architecture/dependency-boundaries.test.ts` remain relevant. Existing Wave 00 transaction, currency and numbering sources were retained.

## B Change plan and executed changes

Investigation followed route registration into authentication/context, permissions, repository ownership, schema constraints, private file access, and the selected-firm API/cache consumers. No dependency or domain model was added. The initial auth/context plan expanded when tracing proved the quotation router permission interception, actor-detail exposure, platform audit scope/atomicity, and attachment path-prefix defect.

All paths in this table are relative to the Bhuminex workspace parent. This table lists every file created or edited by this implementation; it does not inventory unrelated working-tree changes.

| Created or edited file | Why and final logic | Existing code reused |
| --- | --- | --- |
| `backend/src/modules/auth/auth.middleware.ts` | Load the token's live session and included user; reject missing, revoked, expired or foreign-user sessions before authentication | `AuthRepository.findSessionWithUserById`, current lifecycle/password checks and sanitization |
| `backend/tests/auth.middleware.test.ts` | Update session fixture; add missing/revoked/expired/mismatched session, user/firm/role lifecycle denial cases | Existing Vitest middleware harness |
| `backend/src/core/tenancy/tenant-context.ts` | Require a platform-scope access append before granting a selected firm; snapshot actor/session/firm/method/path without query strings | Existing selected-header parsing, active firm lookup, required audit writer |
| `backend/tests/tenant-context.test.ts` | Verify spoof handling, malformed selections, event contents and fail-closed audit errors | Existing request fixtures |
| `backend/prisma/schema.prisma` | Composite User role relation, matching unique role key and referencing index | Existing authoritative User/FirmRole models |
| `backend/prisma/migrations/20261022090000_wave01_identity_boundaries/migration.sql` | Preflight role ownership; add composite FK, identity-shape and event immutability triggers; reclassify proven legacy global audit shapes | Existing identity tables and AuditLog |
| `backend/src/modules/administration/administration.repository.ts` | Check updated role ownership inside the same user-write transaction | Existing `assertRole`, transaction and session revocation |
| `backend/src/modules/audit-logs/audit-logs.repository.ts` | Preserve common list/count firm filter; include only same-firm actor identity in response | Existing audit pagination and nullable user contract |
| `backend/tests/audit-logs.repository.test.ts` | Verify shared filters/pagination and foreign/platform actor redaction | Existing repository injection pattern |
| `backend/src/modules/platform/platform.repository.ts` | Keep global mutations in platform audit scope and require their audit in the mutation transaction | Existing onboarding, firm status, password reset and required audit writer |
| `backend/src/modules/quotations/documents/quotation-documents.routes.ts` | Apply document permission to its three matched routes rather than the whole mounted router | Existing permission middleware and PDF ownership/provider flow |
| `backend/src/modules/quotations/attachments/quotation-attachments.routes.ts` | Apply attachment permission to its five matched routes | Existing upload/access/delete handlers and ownership checks |
| `backend/src/modules/quotations/attachments/quotation-attachment.policy.ts` | Reject directory siblings and escapes using path segments; preserve legacy and firm-owned paths | Existing storage resolver and attachment root |
| `backend/tests/quotation-attachments.policy.test.ts` | Add sibling/escape/root rejection and legacy/firm-path acceptance cases | Existing attachment policy suite |
| `backend/tests/helpers/two-firm-fixture.ts` | Seed uniquely owned firms/actors/relations; guard local disposable URL; clean only owned roots and dependencies | Existing Prisma schema and Wave 00 fixture safety pattern |
| `backend/tests/tenant-isolation.mysql.test.ts` | Add real authenticated HTTP isolation, lifecycle/RBAC matrix, CRUD/foreign IDs, nested links, audit, platform rollback/immutability and private storage cases | Actual app/router/middleware/repositories with a dedicated real Prisma client |
| `backend/docs/architecture/backend/WAVE01-SECURITY-MATRIX.json` | Record current routes, permissions, model relations, trust boundaries and pending runtime evidence | Existing Wave 00 inventory and current source declarations |
| `backend/docs/architecture/backend/WAVE01-SECURITY.md` | Record scope, ownership, migration/recovery, decisions and validation limits | Existing backend architecture documentation |
| `frontend/src/shared/tenancy/selectedFirm.ts` | Add common selected-firm switch with query cancellation/removal and context revision | Existing sessionStorage-backed selection and React Query |
| `frontend/src/features/platform/PlatformFirmsPage.tsx` | Use the common switch before opening a firm workspace | Existing selector, query client and navigation |
| `frontend/src/app/layout/AppLayout.tsx` | Use the same switch when exiting a firm; retain visible selection/branding | Existing layout and selector |
| `frontend/src/shared/api/apiClient.ts` | Tag tenant requests with context revision; cancel stale responses/errors/retries and avoid logout on cancellation | Existing Axios interceptors and refresh flow |
| `frontend/src/shared/api/apiClient.test.ts` | Cover delayed response and firm change during refresh retry | Existing Axios adapter test pattern |
| `frontend/src/shared/tenancy/selectedFirm.test.ts` | Cover cache removal and cancellation of an outstanding query | Existing React Query and selector |
| `frontend/src/features/audit-logs/AuditLogsPage.tsx` | Label a missing/redacted user as system or unavailable actor rather than falsely attributing every such event to the system | Existing nullable actor rendering |

## C Database migration and recovery

One migration is prepared; none was executed. Prisma client regeneration and schema/migration validation remain deferred. The database must support the existing MySQL/Prisma schema, stored routines, `SIGNAL` and triggers. The migration account needs the corresponding routine/trigger privileges. Apply all migrations and regenerate the client in an explicitly authorized disposable environment before acceptance; `db push` alone does not install these triggers.

The preflight rejects existing foreign role assignments, roles without a firm, and FIRM_USER records lacking firm/role. It does not invent an assignment or delete a user. A failed preflight leaves its named procedure available for inspection; resolving the data and failed migration state is an operator action before retry. The procedure must be removed before retrying the full script. Do not disable foreign-key checks.

Schema delta: add unique `firm_roles(id, firm_id)`; add `users(firm_role_id, firm_id)` index; replace the role-ID-only FK with the composite FK using RESTRICT on delete/update. Keep the old role-ID index and current firm FK. Two triggers enforce non-null firm/role shape on firm users. Two further triggers deny UPDATE/reclassification and DELETE of `PlatformFirmAccess` events.

The targeted audit backfill moves only `entity_type = 'Firm'` and User events bearing the existing `passwordResetByPlatformAdministrator: true` marker from firm scope to platform scope. Current source emits these shapes only from the Platform repository. It preserves the target firm as `new_values.targetFirmId`, actor IDs, timestamps, action and old values. Other historical audit events and all quotation/financial/document data are retained. This backfill has not been executed or verified against legacy fixtures.

MySQL DDL can commit in stages. If preflight/DDL/backfill fails, inspect the actual applied statements and use an explicit forward-fix migration and Prisma recovery procedure; do not blindly rerun the file. Prefer a forward application fix over removing the tenant constraints or immutability triggers. An older Prisma client can still query the retained fields, but rolling back the auth fix restores the revoked-session defect. Do not delete audit events or alter historical quotations to simulate rollback. Database administrators must retain the immutable platform events; fixture cleanup deliberately preserves them.

## D API authorization and ownership

No API route, permission key, entitlement key or response envelope was added. Existing permission middleware retains its any-of semantics. Public health and authentication routes keep their established scopes. `/platform/*` requires SUPER_ADMIN. Firm routes inherit authentication plus server-resolved active firm context. The ordinary-user selection header remains ignored, preserving compatibility while preventing a tenant override. A super-admin must explicitly select an active firm.

| Domain | Existing authorization | Ownership enforcement |
| --- | --- | --- |
| Companies, contacts, addresses, history | `companies.view/manage` | Server firm on company; children constrained to that company; quotation history firm-filtered |
| Items and catalog | `items.view/manage`, `catalog.view/manage`; existing options any-of grants | Firm-owned items/categories/units; foreign nested catalog/unit IDs rejected |
| Quotations | Existing `quotations.view/create/edit/status/delete` | Firm-owned quotation; company/contact/address/item snapshots validate ownership before write |
| PDF and attachments | `quotations.documents/attachments` on matching routes | Persisted document/attachment belongs to selected quotation and firm before filesystem access |
| Quotation email and history | Existing document/email permission rules | Firm-owned quotation and nested document/attachment IDs; provider unchanged |
| Settings | Existing profile/bank/quotation-settings permissions; branding read remains authenticated | Business profile owned by firm; bank/settings inherit it |
| Administration | `firm.users.manage`, `firm.roles.manage` | Role/user queries firm-filtered; strict input schemas; composite role FK and transaction-owned validation |
| Dashboard | `dashboard.view` | Counts and aggregates query only the server firm; Wave 00 currency segmentation retained |
| Firm audit | `audit.view` | Same firm filter on list/count; foreign actor detail redacted; platform access/global admin events excluded by scope |
| Platform administration | SUPER_ADMIN account guard | Platform scope; required transactional audit of mutations; no global audit listing added |

Tenant root: `Firm`. Direct firm owners: `User`, `FirmRole`, `BusinessProfile`, `Company`, `ItemCategory`, `MeasurementUnit`, `Item`, `Quotation`, `TermsTemplate`, `ImportBatch`. `AuthSession` inherits User; contacts/addresses inherit Company; bank/quotation settings inherit BusinessProfile; quotation items/history/versions/attachments/documents/communications inherit Quotation; import rows inherit ImportBatch. `AuditLog.firmId` selects tenant scope; null denotes platform/identity scope, and entity type distinguishes platform access. Current relations are enumerated in the JSON matrix.

The access event records **context authorization**, before route permission, validation and execution. Missing/malformed selection and unavailable-firm attempts also require an immutable event, with the denial reason and a null selected firm when parsing failed. It does not assert that a business mutation succeeded. Existing business audit events remain responsible for mutation results. No permission to view platform events is granted through `audit.view`. Actor/session/selected-firm scalar snapshots remain after actor FK cleanup.

Future asynchronous and AI contract: a producer must derive `{ actorId, sessionId, firmId, operation, correlationId }` from authenticated server context, never an arbitrary body/header. Carry that immutable envelope through a trusted queue or authenticated command transport. The executing module must reload the session, user, firm, role/grants and resource ownership at execution and retry time; deny revoked, expired, inactive, deleted or cross-firm contexts. SUPER_ADMIN execution must explicitly retain selected firm and record required platform access before work. Repository calls and result/artifact storage must use that resolved firm, and delivery must recheck the recipient/firm. Do not serialize permission arrays as continuing authority or reuse browser middleware as a worker guard. No currently registered worker/AI/portal/webhook entry point was added; this is the propagation contract for future waves.

## E Completed source features and acceptance mapping

| Section 2 feature | Source achievement | Acceptance state |
| --- | --- | --- |
| 2.1 Tenant-aware reads/writes | Existing firm/parent ownership reused; role persistence and quotation permission composition corrected; authenticated negative probes prepared | Runtime proof BLOCKED by command restriction |
| 2.2 Cross-tenant audit | Shared firm list/count retained; actor detail redacted; platform operations and legacy known shapes separated | Source prepared; DB backfill/filter tests NOT RUN |
| 2.3 Platform boundary | Explicit current account guard and selector preserved; required platform context event plus immutable persistence prepared | Source prepared; migration and failure cases NOT RUN |
| 2.4 Role ownership | Existing strict grants schema reused; update check moved into transaction; composite FK/shape guards prepared | Source prepared; DB rejection NOT RUN |
| 2.5 Protected documents | Public classification confirmed; persisted ownership/static exclusion retained; path sibling defect corrected | Sources and negative tests prepared; runtime NOT RUN |
| 2.6 Lifecycle security | Live session enforced at shared middleware; all 89 firm routes included in lifecycle harness | Source prepared; full route matrix NOT RUN |
| 2.7 Reusable fixtures | Two-firm root/actor/nested fixtures, disposable URL guard and denial helper added | Harness prepared; NOT RUN |

| Section 11 acceptance check | Status |
| --- | --- |
| Disposable MySQL suite exists and passes | Exists; passing result BLOCKED / NOT RUN |
| All business routes verified | 102 route declarations inventoried; 89 firm routes have lifecycle coverage sources and per-route RBAC probes; runtime NOT VERIFIED |
| Audit rows/counts/filters isolated | Source and unit/DB regressions prepared; NOT RUN; no export endpoint currently registered |
| Private documents excluded from static | Existing config retained, boundary hardened, actual temporary files included in DB harness; runtime NOT VERIFIED |
| Platform and firm responsibilities separate/observable | Source, migration, event and rollback tests prepared; migration NOT APPLIED |
| Regression/architecture suites pass | NOT RUN; no passing claim |

Summary and achievements: shared session revocation is now part of authentication; quotation capabilities enforce their own permissions; selected-firm support access is attributable and fails closed; role ownership has a prepared database boundary; firm audit responses avoid cross-scope actor details; global platform writes require transactional audit; and frontend selection changes invalidate outstanding tenant responses. No duplicate model, provider, auth framework, calculation engine or entitlement system was introduced.

## F Validation and exact deferred commands

Completed work was limited to source/architecture reads, targeted searches, direct local Git-reference reads, Word XML extraction, source edits and static inventory generation. There is no command output from typechecking, tests, linting, builds, Prisma validation, migration execution or runtime/browser verification. No skipped check is reported passing.

All commands below are future commands, **NOT EXECUTED**. Explicit user authorization remains required.

| Working directory | Exact command | Status and prerequisite |
| --- | --- | --- |
| Backend | `npm test -- tests/auth.middleware.test.ts tests/auth.routes.test.ts tests/tenant-context.test.ts tests/audit-logs.repository.test.ts tests/audit-log.test.ts tests/quotation-attachments.policy.test.ts tests/public-assets.test.ts tests/architecture/dependency-boundaries.test.ts` | NOT RUN: commands deferred |
| Backend | `npm test -- tests/tenant-isolation.mysql.test.ts` | NOT RUN: commands deferred; needs explicitly provisioned local disposable MySQL with all migrations applied and regenerated Prisma client |
| Backend | `npm test -- tests/quotations.mysql.test.ts` | NOT RUN: commands deferred; existing Wave 00 disposable DB prerequisite retained |
| Backend | `npm run typecheck` | NOT RUN: commands deferred |
| Backend | `npm run lint` | NOT RUN: commands deferred |
| Backend | `npm test` | NOT RUN: commands deferred; existing failure baseline unknown |
| Backend | `npm run build` | NOT RUN: commands deferred |
| Backend | `npm run prisma:validate` | NOT RUN: commands deferred |
| Frontend | `npm test -- src/shared/api/apiClient.test.ts src/shared/tenancy/selectedFirm.test.ts src/app/layout/AppLayout.test.tsx src/features/auth/__tests__/routes.test.tsx` | NOT RUN: commands deferred |
| Frontend | `npm run typecheck` | NOT RUN: commands deferred |
| Frontend | `npm run lint` | NOT RUN: commands deferred |
| Frontend | `npm test` | NOT RUN: commands deferred |
| Frontend | `npm run build` | NOT RUN: commands deferred |

The new integration suite reads only `WAVE01_TEST_DATABASE_URL`, accepts `mysql:` loopback URLs with database names `wave01_test_<suffix>`, and checks the new migration is recorded as successfully applied before seeding. It injects that real Prisma client into the actual app, overrides storage with a uniquely created OS temporary directory, and makes real authenticated requests to a loopback listener. It does not migrate, install, use the normal database as fallback, or send external mail. Mail/PDF providers are replaced with throwing guards; private PDF download fixtures use persisted files rather than calling a renderer.

Fixtures immediately track created firm roots and delete only their dependencies, users and roots. Platform actors use unique identifiers; immutable platform events intentionally remain with snapshot IDs after fixture actor cleanup. Their cleanup must not bypass the immutability trigger. The disposable database's eventual retirement is an explicit operator action, not a test action.

Prepared negative cases include direct foreign IDs, nested contact/address/item/category/unit/role IDs, ordinary forged headers, platform absent/malformed headers, filtered/count/paginated audit and foreign actors, private download ownership/static guessing/traversal, file-upload cleanup, revoked/expired sessions, locked/inactive/deleted users and suspended/deleted firms. Prepared positive cases include firm-owned CRUD, valid private downloads, public assets, current support access, and independent assignable quotation grants. Platform audit failure injection checks rollback of firm suspension and session revocation.

Quota/entitlement matrix: NOT IMPLEMENTED, intentionally excluded until Wave 02. Existing user limits remain; no quota proof is claimed. Wave 00 numbering/concurrency/financial failure-injection suites remain unchanged and NOT RUN. New migration preflight, legacy audit backfill, trigger syntax/privileges, MySQL constraint enforcement, browser rendering, SMTP/PDF provider contracts, full concurrency and regressions remain NOT VERIFIED. There are no worker outputs or audit export routes to exercise in the current registered API.

## G Risk register decisions and next-wave recommendation

| Risk or assumption | Current state and correctness follow-up |
| --- | --- |
| Runtime confidence | No checks were executed. Authorize targeted validation, then full required checks before treating the wave as accepted |
| Migration correctness and deployment order | Migration/client generation/trigger privileges and legacy data preflight must be verified on disposable MySQL; deploy constraints and compatible application together |
| Partial MySQL DDL | Inspect failed migration state and forward-fix deliberately; do not blindly replay DDL or disable ownership constraints |
| Legacy audit reclassification | Only source-proven platform event shapes are moved; verify representative existing records and preserved target IDs before applying |
| Immutable access retention | Events survive fixture actor cleanup by design; retain them rather than weakening the trigger |
| Public images/branding | Confirmed user policy: item images, logos, signatures and stamps remain public; quotation PDFs/attachments remain private |
| Selected-firm actions | Confirmed user policy: retain existing actions; append required immutable context authorization events |
| Future background work | Propagation contract documented; future workers must implement execution-time validation rather than trusting queued permissions |

No product-policy decision remains pending for this implementation. The remaining gates are verification and migration application, both intentionally deferred. Shared route guards, repository-owned persistence, existing permission keys, nullable actor response shape, existing private providers and historical financial behavior are preserved. Backward-compatible API paths remain; intended security changes reject revoked sessions and invalid role relations and remove global platform events from firm feeds.

**Recommendation: NO-GO for Wave 02 acceptance or production rollout until the migration, focused MySQL matrix, architecture checks and backend/frontend regressions actually pass.** Wave 01 source preparation is complete; Wave 01 runtime acceptance is not complete. No restricted commands were executed.
