# Wave 02 Platform Plans Entitlements and Subscription Lifecycle

Wave 02 source implementation is prepared across backend and frontend. Runtime acceptance remains **PENDING**. On 26 October 2026, explicitly approved Prisma Client generation and the backend build both passed. Tests, the separate typecheck scripts, Git, linting, formatting, installations, migrations, containers, frontend build and deployment remain deferred. A passing backend build does not certify an applied migration or production readiness.

The user explicitly accepted the current Wave 01 source as the prerequisite while retaining deferred validation. The user instructed that existing repository policies be reused and unapproved policies remain configurable and unpublished. Only the reserved legacy access snapshots are backfilled; their commercial policy is NULL. New commercial plans are not seeded or automatically published. Live checkout remains blocked on provider selection and verification.

## A Baseline inventory and repository references

| Repository | Branch read from HEAD | Commit read from loose branch reference |
| --- | --- | --- |
| Backend | `feat/wave3` | `95e31a0fef32845646e51117b6a0860b735947ad` |
| Frontend | `feat/wave3` | `57172726600e36186eac7f32371fcbf37ba41c9f` |

These values came from read-only `.git/HEAD` and reference-file reads. Git status and diff were NOT RUN; no clean-working-tree claim is made. Existing edits were preserved through targeted patches.

| Capability | Baseline | Implementation |
| --- | --- | --- |
| Firm identity, suspension, selected-firm context | Present in `core/tenancy/tenant-context.ts` and auth helpers | Reused unchanged; ordinary actors still derive their firm from their authenticated identity |
| SUPER_ADMIN firm management | Present in platform routes/repository/schema | Extended through a platform capability router under the existing account guard |
| Per-user RBAC | Present in backend/frontend permission registries | Existing keys and any-of semantics preserved; entitlements independently gate authorized alternatives |
| User capacity | Present as `Firm.userLimit` and serializable user creation | Replaced at enforcement with shared quotas; response `userLimit` is derived from effective entitlement |
| Plans, published revisions, subscriptions, overrides | Absent | Additive models, management APIs and UI added |
| Usage ledger, storage baseline, quota diagnostics | Absent | Firm-locked counters/events, explicit reconciliation and read diagnostics added |
| Payment provider | No subscription gateway | Administrative/manual ledger and adapter contract only |
| Regression foundation | Existing auth, tenancy, quotation and two-firm suites | Extended without executing them |

Architecture authority: `BACKEND-MODULE-RULES.md` and `BACKEND-DEPENDENCY-BOUNDARIES.md`. Platform owns management workflows and platform subscription audit. The entitlement module owns feature evaluation, quota accounting and persistence helpers. Core and integrations do not import business modules. Schema validation uses a persistence-free public contract.

## B Planned and executed changes

The planned registry → schema/backfill → server gates/accounting → management UI → regression sequence was followed. Tracing added necessary storage consumers in item images and branding, exact preview fingerprints, scheduled-assignment provenance restoration, and pending legacy storage accounting. No dependencies were added.

Paths below are relative to the Bhuminex parent directory. This is the complete implementation file inventory, including this report.

| File | Change and purpose | Existing implementation reused |
| --- | --- | --- |
| `backend/prisma/schema.prisma` | Add 12 platform/entitlement models, firm relations and pending storage deltas; mark legacy user limit ownership | Firm, existing Prisma conventions, Decimal |
| `backend/prisma/migrations/20261026090000_wave02_platform_entitlements/migration.sql` | Add tables, indexes, legacy snapshots/baselines and immutability triggers | Existing MySQL migrations and firm/user/document tables |
| `backend/src/bootstrap/registerRoutes.ts` | Register firm-facing entitlement read router | Existing API router registration |
| `backend/src/integrations/storage/storage.service.ts` | Expose safe managed-file size reads, treating missing files as zero | Existing confined storage resolver/service |
| `backend/src/modules/entitlements/feature-registry.ts` | Define frozen stable keys, modules, dependencies, defaults and permission mapping | Existing permission vocabulary and domain relationships |
| `backend/src/modules/entitlements/entitlement-evaluator.ts` | Evaluate firm/subscription/global/plan/override/dependency/RBAC decisions and quota arithmetic | Existing firm lifecycle semantics |
| `backend/src/modules/entitlements/entitlements.schema.ts` | Validate explicit commercial policies; keep legacy ACTIVE/SUSPENDED adapter internal | Zod validation conventions |
| `backend/src/modules/entitlements/entitlements.repository.ts` | Load effective revisions, select latest effective overrides, lock firm writes, account idempotently and reconcile baselines | Prisma transactions, firms, users, retained documents, storage provider |
| `backend/src/modules/entitlements/contract.ts` | Expose validation primitives without loading persistence | Narrow public module boundaries |
| `backend/src/modules/entitlements/index.ts` | Export the entitlement capability explicitly | Existing explicit index pattern |
| `backend/src/modules/auth/auth.middleware.ts` | Apply entitlement checks only to permission alternatives the actor actually holds | Authentication, temporary-password gates and RBAC |
| `backend/src/modules/platform/platform.routes.ts` | Mount subscription management beneath existing SUPER_ADMIN checks | Existing platform router |
| `backend/src/modules/platform/platform.repository.ts` | Provision legacy subscriptions atomically and derive compatibility user limits | Existing firm/bootstrap/audit transaction |
| `backend/src/modules/platform/platform-subscriptions.schema.ts` | Validate management payloads, IDs, dates, quotas, preview tokens and money strings | Zod and entitlement validation contract |
| `backend/src/modules/platform/platform-subscriptions.repository.ts` | Implement plans/drafts/publication, assignments, overrides, paged histories, audit, reconciliation and manual money ledger | Existing Prisma/error conventions and entitlement helpers |
| `backend/src/modules/platform/platform-subscriptions.routes.ts` | Add platform management endpoints with parsed contracts | Existing async handler and success envelope |
| `backend/src/modules/platform/firm-entitlements.routes.ts` | Expose effective access for the server-resolved firm | Existing authentication and firm context |
| `backend/src/modules/platform/subscription-provider.ts` | Specify checkout/verified-event adapter; declare manual mode | Existing separation between providers and domains |
| `backend/src/modules/platform/index.ts` | Export only platform and firm entitlement routers | Existing explicit index |
| `backend/src/modules/administration/administration.repository.ts` | Meter user creation/deletion with the resource transaction and derive displayed limits | Existing role ownership, user/session and password workflows |
| `backend/src/modules/items/items.repository.ts` | Account image replacement/deletion under the firm lock; retain shared referenced paths | Existing item ownership, image policy and audit |
| `backend/src/modules/settings/branding/branding.repository.ts` | Account branding replacement/deletion and retain shared referenced paths | Existing profile, branding policy and settings audit |
| `backend/src/modules/quotations/documents/quotation-documents.repository.ts` | Meter retained PDFs/storage atomically, make metadata accounting idempotent and allocate versions under the lock | Existing quotation/document models and provider outputs |
| `backend/src/modules/quotations/documents/quotation-documents.routes.ts` | Pass trusted firm/size metadata and retain quota denial status during file compensation | Existing PDF generation/storage/download flow |
| `backend/src/modules/quotations/attachments/quotation-attachments.repository.ts` | Serialize attachment capacity/storage changes with metadata; meter releases | Existing attachment ownership, limits, audit and storage |
| `backend/tests/entitlement-evaluator.test.ts` | Add access truth matrix, boundary, dependency, legacy, expiry and integer cases | Existing Vitest conventions |
| `backend/tests/platform-subscriptions.validation.test.ts` | Add strict ownership, policy, quota, money and expiry contract cases | Existing Zod/Vitest validation style |
| `backend/tests/platform-entitlements.mysql.test.ts` | Add opt-in real HTTP/DB isolation, contention, rollback, publication, expiry, storage and manual ledger scenarios | Existing disposable listener/provider-stub fixture approach |
| `backend/tests/auth.middleware.test.ts` | Cover independent RBAC/entitlement composition and authorized alternatives | Existing authentication suite/mocks |
| `backend/tests/helpers/two-firm-fixture.ts` | Add Wave 02 URL opt-in and optional immutable-ledger tenant tombstones | Existing uniquely owned A/B fixture and scoped cleanup |
| `backend/docs/architecture/backend/WAVE02-PLATFORM-ENTITLEMENTS.md` | Record implementation, ownership, migration, evidence and deferred acceptance | Prior-wave report structure |
| `frontend/src/shared/tenancy/entitlements.ts` | Add actor/firm-keyed, cancellable advisory access query and permission selector | Existing selected-firm revision and API client |
| `frontend/src/shared/routing/paths.ts` | Add platform plan/subscription and firm usage paths | Existing typed path registry |
| `frontend/src/features/auth/hooks/useHasPermission.ts` | Combine existing user permissions with advisory effective access | Existing shared action-visibility hook |
| `frontend/src/app/router/guards/AccessRoute.tsx` | Wait for access resolution; deny direct URLs when subscribed access denies | Existing account/firm/RBAC guard |
| `frontend/src/app/router/routeConfig.tsx` | Add navigation and filter business entries by effective permissions | Existing navigation metadata |
| `frontend/src/app/router/router.tsx` | Wire lazy management/usage pages behind existing guards | Existing protected layout/lazy routing |
| `frontend/src/app/layout/AppLayout.tsx` | Supply firm access to navigation filtering | Existing layout, auth and selected firm |
| `frontend/src/app/layout/AppLayout.test.tsx` | Supply explicit allowed entitlement fixture to existing navigation tests | Existing layout regression suite |
| `frontend/src/features/platform/PlatformFirmsPage.tsx` | Link each firm to its subscription editor | Existing firm table and router navigation |
| `frontend/src/features/platform/subscriptions.types.ts` | Define management, revision, policy, history and ledger response contracts | Existing platform/auth types and API envelope |
| `frontend/src/features/platform/subscriptions.api.ts` | Add typed management requests, preview tokens and history pagination | Existing API client |
| `frontend/src/features/platform/usePlatformOperation.ts` | Share mutation/invalidation behavior | React Query and existing auth cache separation |
| `frontend/src/features/platform/PlatformPlansPage.tsx` | Add plan CRUD, draft CRUD, feature matrix, quotas, pricing, policy approval, exact preview and global switches | Existing MUI/AppButton/PageContainer components |
| `frontend/src/features/platform/PlatformSubscriptionsPage.tsx` | Add searchable firm selection, assignments, overrides, paged histories, reconciliation and manual ledger | Existing firm APIs, design components and mutation helper |
| `frontend/src/features/platform/EffectiveAccessPanel.tsx` | Present firm/user decisions, explanations and capacity | Existing table/layout components |
| `frontend/src/features/platform/FirmEntitlementsPage.tsx` | Expose the current firm's subscription and usage | Existing auth context and advisory query |
| `frontend/src/features/platform/PlatformAuditPanel.tsx` | Show paginated platform audit with provenance | Existing React Query/components |
| `frontend/src/features/platform/UsageEventsPanel.tsx` | Show paginated idempotent usage events | Existing React Query/components |
| `frontend/src/features/platform/subscriptions.test.tsx` | Cover direct URL/navigation/account guards and preview-before-publication workflow | Existing RTL/Vitest/MUI patterns |
| `frontend/src/features/platform/index.ts` | Export management and firm usage pages explicitly | Existing feature public index |

## C Database migration and recovery plan

New models: `PlatformFeatureSwitch`, `Plan`, `PlanVersion`, `PlanFeatureEntitlement`, `PlanQuota`, `FirmSubscription`, `FirmFeatureOverride`, `UsageCounter`, `UsageEvent`, `SubscriptionEvent`, `PlatformCharge`, `PaymentEvent`. Existing business document models are reused; no tenant sales Invoice model is introduced. The schema adds four Firm relations; `Firm.userLimit` remains a legacy provisioning baseline rather than an independent enforcement source.

Backfill creates one reserved legacy plan with immutable revisions for distinct existing user capacities, including the default capacity four. Each capacity is at least one and at least the firm's existing undeleted user count. Existing firms receive ACTIVE snapshots with all ten enumerated legacy features; future AI is excluded. User/document baselines are counted from persisted records. Storage remains explicitly unmeasured until reconciliation. Commercial lifecycle policy and pricing remain unset on legacy snapshots. The adapter supports their existing ACTIVE/SUSPENDED access only; trial, grace and cancellation require an explicitly approved published commercial plan.

Counter semantics: `users` counts undeleted accounts including the administrator and inactive accounts; `documents` counts retained generated PDF records including history; `storageBytes` counts unique managed file references across retained PDFs, active attachments, item images and branding; missing files contribute zero. `aiCredits` is a lifetime accounting/reservation primitive for future trusted callers. No periodic credit reset, automatic charge, retention deletion or inferred renewal is implemented.

Unmeasured storage writes append signed usage events and update `pendingDelta`, preserving existing unlimited writes without a full file scan. No partial storage total is presented as known. Explicit reconciliation measures the current baseline, folds the pending balance into a compensating baseline event and marks the counter ready. Finite storage assignment/override requires readiness. It does not reset document/user counters during a normal PDF write.

Important keys/indexes: plan slug; `(planId, revision)`; plan-version/feature and plan-version/resource primary keys; `(firmId, effectiveFrom)`; `(firmId, target, startsAt)`; `(firmId, resource)` counters; `(firmId, resource, eventId)` idempotent usage; global charge/payment idempotency keys; firm/time indexes on subscriptions, overrides, accounting and audit. Plan publication, feature rows and quota rows become immutable; usage, subscription events, charges and payment events are append-only through MySQL triggers.

Usage/subscription event tenant/actor IDs are retained scalar snapshots, intentionally surviving identity cleanup. Charges retain their firm through a restrictive relation. The opt-in fixture preserves only its own soft-deleted tenant tombstones when immutable charges reference them.

Rollout remains deferred. In an authorized disposable environment, review all prior migrations and this SQL, apply them, regenerate Prisma, then execute the checks below. For a later live rollout, quiesce old writers while baseline counts are taken; deploy backend/frontend together and reconcile storage before finite limits. MySQL DDL is not fully transactional: a failed migration requires inspection and a reviewed forward fix, not a blind retry or table drop. Preserve snapshots and ledger events. Reverting only the application to pre-Wave-02 code would remove entitlement enforcement, so prefer a forward fix and keep business traffic gated if rollback becomes necessary.

## D API domain feature and ownership contracts

Existing `/api/v1/platform` authentication and SUPER_ADMIN account checks govern every management endpoint. Temporary passwords must be changed first. Standard firm permissions never grant platform administration.

| Endpoint family | Contract |
| --- | --- |
| `GET /platform/features`, `PATCH /platform/features/:key` | Registry inspection and reasoned global hard switches |
| `GET/POST /platform/plans`, `GET/PUT/DELETE /platform/plans/:id` | Paged list, creation, rename/archive; DELETE archives without deleting history |
| `POST /platform/plans/:id/versions`, `PUT/DELETE .../:versionId` | Create/edit/delete unpublished drafts; published revisions cannot change |
| `GET .../:versionId/preview`, `POST .../:versionId/publish` | Return saved snapshot/errors/fingerprint; publication requires that exact fingerprint and reason |
| `GET/PUT /platform/firms/:id/subscription` | Effective access plus independently paged histories; expected-current-ID and explicit effective dates on assignment |
| `DELETE /platform/firms/:id/subscription/:versionId` | Cancel only a future subscription assignment; the trailing value is a subscription ID; restore the preceding end from immutable provenance |
| `GET/POST /platform/firms/:id/overrides`, `DELETE .../:overrideId` | Paged override inspection, explicit ALLOW/DENY/LIMIT and reasoned revocation |
| `GET /platform/usage?firmId=...`, `GET /platform/firms/:id/usage/events`, `POST .../usage/reconcile` | Diagnostics, paged usage ledger and explicit measurement |
| `GET /platform/audit` | Paged global or target-firm platform subscription events |
| `POST /platform/firms/:id/charges`, `POST .../charges/:chargeId/payments` | Manual Decimal charges, partial payments and compensating refunds; strict charge ownership and idempotency |
| `GET /entitlements/me` | Advisory own-firm access/remaining limits using server-established context; caller-supplied firm queries do not change ownership |

Subscription history query keys are `subscriptions`, `overrides`, `charges`, each a positive page number with 20 rows per history page. Override-only history accepts `page`. Plan, usage-event and audit lists use their parsed pagination limits.

| Feature | Existing RBAC mapping |
| --- | --- |
| `firm.core` | Existing `firm.*.manage` identity/settings permissions; system required, still subject to firm/subscription/global denial |
| `dashboard` | `dashboard.view` |
| `companies` | `companies.view`, `companies.manage` |
| `catalog` | `catalog.view`, `catalog.manage` |
| `items` | `items.view`, `items.manage`; depends on catalog |
| `quotations` | Existing quotation view/create/edit/status/delete permissions; depends on companies; manual item lines remain supported |
| `quotations.documents` | `quotations.documents`; depends on quotations |
| `quotations.email` | `quotations.email`; depends on document capability |
| `quotations.attachments` | `quotations.attachments`; depends on quotations |
| `audit` | `audit.view` |
| `ai.credits` | Reserved, legacy DENY; no AI endpoint or new user permission introduced |

Effective business access combines active firm, effective allowed subscription, global availability, published plan/authorized exception, dependencies and independent user RBAC. Capacity is additionally enforced on consuming mutations. Capacity exhaustion does not remove existing PDF/history read access. Expiry uses exclusive end boundaries. Latest effective override replacement wins; expiry or revocation returns to the plan, without reviving an earlier grant. A global hard disable always denies.

| Data | Ownership/read boundary |
| --- | --- |
| Plans, revisions, global switches | Platform-owned; SUPER_ADMIN management only |
| Subscription/override/counter | Firm-owned; platform management; own-firm advisory view only |
| Usage events | Firm snapshot; platform-only, explicitly firm-filtered event reads |
| Subscription audit events | Platform-owned, optionally target-firm tagged; never added to tenant business audit feeds |
| SaaS charges/payments | Platform-owned, charge → firm ownership; independent of tenant quotations/sales billing |
| Existing business rows/files/audit | Existing firm/parent boundaries and providers retained |

No worker, AI, portal or payment-webhook endpoint was added. A future trusted executor must re-establish actor/firm/RBAC, call feature checks and account within the same firm-locked resource transaction; a duplicate accounting receipt must not repeat the resource side effect.

## E Completed features and acceptance mapping

| Specification feature | Source status | Acceptance status |
| --- | --- | --- |
| 2.1 Registry | Frozen keys/descriptions/modules/dependencies/defaults and deterministic evaluator prepared | Runtime NOT RUN |
| 2.2 Plan editor | Plan and draft CRUD, feature/quota/pricing editor, explicit policy approval, snapshot preview and immutable publication prepared | Runtime NOT RUN |
| 2.3 Assignments/lifecycle | Trial/active/past-due/cancelled/suspended, explicit dates, renewal metadata, scheduled replacement/cancellation and pinned revisions prepared | Runtime NOT RUN; no automatic billing scheduler |
| 2.4 Overrides | ALLOW/DENY/LIMIT, author/reason/start/expiry/revocation and audit prepared | Runtime NOT RUN |
| 2.5 Backend checks | Existing permission entry point composes entitlements; consuming repositories recheck and account | Runtime NOT RUN |
| 2.6 Usage/limits | Atomic user/document/storage mutations, pending legacy storage, reconciliation and future AI accounting prepared | MySQL contention/rollback NOT RUN |
| 2.7 Legacy safety | Reserved snapshots, per-capacity user limits and safe storage readiness prepared | Actual migration/backfill NOT RUN |
| 2.8 Administration UI | Plans/features/revisions, assignments, overrides, usage, histories, audit and access explanations prepared | RTL/browser NOT RUN |
| 2.9 Provider boundary | Separate manual ledger and provider contract prepared | Live checkout BLOCKED pending selected/configured provider and verified events |

| Acceptance item | Evidence prepared | Result |
| --- | --- | --- |
| 11.1 Create/publish plan | Editor, preview fingerprint, publish validation, immutable DB guards | PENDING / NOT RUN |
| 11.2 Assign plan/overrides | Platform routes, optimistic current subscription ID, audit and dates | PENDING / NOT RUN |
| 11.3 Firm isolation | Existing context plus negative A/B HTTP probes and parent-ID checks | PENDING / NOT RUN |
| 11.4 Direct API denial/baseline access | Shared middleware, legacy migration and request probes | PENDING / NOT RUN |
| 11.5 Traceability/concurrency | Firm locks, unique ledger keys, required transactional events and failure injection | PENDING / NOT RUN |
| 11.6 No unverified live checkout | Manual-only mode, no gateway route or outgoing financial operation | Exclusion respected in source; live charging NOT IMPLEMENTED |

## F Validation evidence and command status

No test output exists because tests remain deferred. Read-only source tracing covered the required platform/auth/tenancy/Prisma/frontend consumers, current migration history and relevant test sources. No skipped or unrun check is reported as passing.

The 26 October follow-up traced the reported 75 TypeScript errors to the stale generated client in the workspace parent's `node_modules/.prisma/client`: it lacked the Wave 02 models present in `backend/prisma/schema.prisma`. The missing delegates and model types also broke callback type inference. The existing CI workflow already generates Prisma before building. After explicit command approval, the exact backend command `npm run prisma:generate && npm run build` completed with exit code 0. Prisma Client v5.22.0 was regenerated from the current backend schema, and `tsc` completed without diagnostics. No application source changes, database migration or type workarounds were required. Generated client/build artifacts were refreshed; this report records the validation result.

Prepared test coverage: the pure evaluator matrix combines plan/override/global kill/RBAC/firm/subscription/quota; validation checks ownership injection, quotas and decimal strings; middleware checks authorized alternatives; disposable MySQL sources exercise tenant probes, concurrent seats, duplicate usage, rollback on resource/audit failure, pinned revisions, immutable rows, trial expiry, future/expired/revoked overrides, subscription suspension, exact schedule recovery, PDF quota/history, pending storage/reconciliation, stale preview rejection and partial/duplicate/refund payment contention. Frontend sources cover direct URLs, account restrictions, navigation, pending/error gates, draft policy and preview publication. Existing quotation and tenant suites remain relevant and unrun.

| Working directory | Exact command | Result/reason |
| --- | --- | --- |
| Backend | `npm run prisma:generate` | PASS: explicitly approved follow-up; Prisma Client v5.22.0 generated from the current backend schema |
| Backend | `npm run prisma:validate` | NOT RUN: commands deferred |
| Backend | `npm run typecheck` | NOT RUN: commands deferred |
| Backend | `npm run lint` | NOT RUN: commands deferred |
| Backend | `npm test` | NOT RUN: commands deferred |
| Backend | `npm run build` | PASS: explicitly approved follow-up; `tsc` exited successfully after client regeneration |
| Backend | `npm test -- tests/entitlement-evaluator.test.ts tests/platform-subscriptions.validation.test.ts tests/auth.middleware.test.ts tests/architecture/dependency-boundaries.test.ts` | NOT RUN: commands deferred |
| Backend | `npm test -- tests/platform-entitlements.mysql.test.ts` | NOT RUN: commands deferred; requires explicitly configured disposable DB with current migrations applied |
| Backend | `npm test -- tests/tenant-isolation.mysql.test.ts tests/quotations.mysql.test.ts` | NOT RUN: existing opt-in DB prerequisites and command restrictions retained; current application needs current schema |
| Frontend | `npm run typecheck` | NOT RUN: commands deferred |
| Frontend | `npm run lint` | NOT RUN: commands deferred |
| Frontend | `npm test` | NOT RUN: commands deferred |
| Frontend | `npm run build` | NOT RUN: commands deferred |
| Frontend | `npm test -- src/features/platform/subscriptions.test.tsx src/app/layout/AppLayout.test.tsx` | NOT RUN: commands deferred |

The new MySQL suite uses only `WAVE02_TEST_DATABASE_URL`: mysql protocol, loopback host, database name `wave02_test_<suffix>`. It checks that Wave 01 and Wave 02 migrations were recorded as applied before fixtures. It never migrates or falls back to the application database. The suite owns unique A/B data, uses a loopback HTTP listener and temporary storage, stubs mail/PDF providers, and retains immutable ledger history/tombstones rather than deleting it. The integration environment was not inspected or contacted.

Actual legacy migration execution, SQL syntax/trigger privileges, rollback against MySQL, browser rendering, full regressions and provider sandbox checks are NOT VERIFIED. A selected gateway's webhook/sandbox tests are NOT IMPLEMENTED because no gateway was selected. No tax/legal policy or tenant sales invoice work was introduced.

## G Risks decisions and next-wave recommendation

| Risk/decision | Treatment |
| --- | --- |
| Validation incomplete | Client generation and backend build passed; tests, migration rehearsal, frontend checks and browser validation remain deferred |
| Migration deployment overlap | Quiesce old writers for baseline capture; review MySQL partial-DDL recovery and privileges before rollout |
| Large legacy storage baselines | Reconciliation holds a firm lock with a bounded transaction timeout; measure on representative firms. Legacy unlimited writes do not trigger this full scan |
| Filesystem/database boundary | Existing compensation is retained; failed filesystem cleanup can leave unreferenced physical files. Quotas describe managed referenced bytes, not total disk allocation; investigate cleanup failures before operational storage billing |
| Commercial policy | Initial commercial plans/prices/trial/grace/cancellation/downgrade/retention remain owner decisions. Drafts can retain NULL policy; publication requires complete explicit terms. Only retention without deletion is supported |
| Provider choice | Manual ledger only. Live checkout/webhooks/automatic renewals require an approved adapter, configuration and sandbox/idempotency evidence |
| Future execution | AI accounting is a primitive, not an AI service. No background job or automatic quota reset is claimed |

Source-level validation: the missing entitlement layer is addressed centrally; affected permission, user, document, attachment, image, branding, platform and navigation consumers were updated. Existing firm context, RBAC keys, business audit ownership, success envelopes and provider boundaries were preserved. Quota and decision logic are shared instead of duplicated in callers. Runtime backward compatibility and concurrency remain unverified until the deferred checks run.

**Recommendation: NO-GO for production or next-wave runtime acceptance until the remaining migration and backend/frontend checks pass.** Provider-independent source work is prepared. Only explicitly approved Prisma generation and backend build commands were executed; other restricted commands remain deferred.
