# Wave 09 Business Assistant Implementation Report

Wave 09 adds the local assistant, per-firm mode controls, bounded domain tools, reviewed actions and usage/retention infrastructure. Live ChatGPT account connection and inference are **BLOCKED**, not implemented or represented as working. All executable validation is **NOT RUN** under the user's command restrictions. This is not an acceptance or production-readiness certificate.

## A Baseline inventory

The backend and frontend both identify `feat/wave9` in their on-disk HEAD references. The referenced commits at inspection were backend `ced64319bc15e643e774a962a350e1a56c0d883b` and frontend `aa0f4bbf6eadfbbad34666d9f2fa68a9c0a52819`. These were read as files; no git command, status or diff was executed. No claim is made about pre-existing uncommitted changes.

Already present: authenticated firm context, custom firm roles, plan entitlements and overrides, global feature switches, `ai.credits`, `aiCredits` usage events/counters, required audit logging, firm-locked transactions, domain read APIs, Wave 08 approval policies and six bounded approval action contracts.

Previously partial: `ai.credits` was reserved without an assistant consumer. Wave 08 validates/consumes approvals inside domain commands; it is not a general command executor. The existing dashboard describes quotations, so issued invoice sales are reported in the billing domain instead of relabeling quotation metrics as revenue.

New: `assistant.local`, assistant RBAC permissions, the local planner, mode resolver, domain projections, assistant persistence/APIs, confirmed command orchestration, user interfaces and evaluation/integration test sources.

## B Plan and executed changes

The planned local/control-plane work is implemented in source. The requested normal ChatGPT login remains blocked by the external registration requirement. No API-key substitute, CLI-token reuse, dynamic open-source client impersonation, credential import or shared personal account was added.

Paths below are relative to `Bhuminex`.

| Created or edited file | Purpose and existing implementation reused |
| --- | --- |
| `backend/src/modules/assistant/assistant.schema.ts` | Strict request/tool contracts; reuses Wave 08 commands, common dates and currency registry. |
| `backend/src/modules/assistant/assistant.provider.ts` | Local supported-intent rules, recognized PII/credential redaction, typed provider boundary and explicit commercial-integration-unavailable state. |
| `backend/src/modules/assistant/assistant-mode.ts` | Independent mode/RBAC/entitlement checks, quotas and authorized local fallback; uses existing entitlement evaluator. |
| `backend/src/modules/assistant/assistant.tools.ts` | Fixed domain read tools, authorized unsaved drafts and untrusted delimited document-text candidates. |
| `backend/src/modules/assistant/assistant.commands.ts` | Exact target evidence, current access checks and dispatch only to the six existing domain commands. |
| `backend/src/modules/assistant/assistant.repository.ts` | Conversation ownership, request deduplication, LLM-attempt reservations, confirmation nonce/expiry, atomic execution audit and content retention. |
| `backend/src/modules/assistant/assistant.routes.ts` | Authenticated firm-only APIs, trusted-origin mutation checks, rate limits and no-store responses. |
| `backend/src/modules/assistant/index.ts` | Narrow router and retention-worker exports. |
| `backend/src/modules/auth/permissions.ts` | Local, LLM and firm-admin settings permissions; local/LLM access assignable to firm roles. |
| `backend/src/modules/auth/index.ts` | Reuses existing permission resolution through an explicit public export. |
| `backend/src/modules/entitlements/feature-registry.ts` | Adds local entitlement and activates the existing AI permission mapping; no automatic plan grants. |
| `backend/src/modules/automation/contract.ts` | Persistence-free public action/schema boundary. |
| `backend/src/modules/automation/approvals.repository.ts` | Exposes existing validated command preparation; approval rules remain in their original workflow. |
| `backend/src/modules/automation/runtime.ts` | Narrow command-preparation export without configuration routes. |
| `backend/src/modules/companies/assistant-read.repository.ts` | Projects the conventional company search without contact/address payloads. |
| `backend/src/modules/companies/index.ts` | Exports that read projection. |
| `backend/src/modules/items/assistant-read.repository.ts` | Projects conventional catalog search without descriptions or source URLs. |
| `backend/src/modules/items/index.ts` | Exports that read projection. |
| `backend/src/modules/quotations/assistant-read.repository.ts` | Reuses latest-revision quotation search. |
| `backend/src/modules/quotations/quotations.repository.ts` | Extracts the existing status command into a transaction entry point and rechecks command authorization. |
| `backend/src/modules/quotations/index.ts` | Exports bounded read/status operations. |
| `backend/src/modules/invoices/assistant-read.repository.ts` | Reuses invoice search and adds currency-separated issued sales through shared Decimal/money primitives. |
| `backend/src/modules/invoices/invoices.repository.ts` | Extracts transaction entry points for existing issue/void commands, preserving their original validation, approvals, numbering and events. |
| `backend/src/modules/invoices/index.ts` | Exports bounded read/command operations. |
| `backend/src/modules/payments/assistant-read.repository.ts` | Reuses payment search and the existing reconciled receivables/ageing report. |
| `backend/src/modules/payments/index.ts` | Exports those reads. |
| `backend/src/modules/sales-orders/assistant-read.repository.ts` | Reuses existing actor- and capability-checked order search. |
| `backend/src/modules/sales-orders/sales-orders.repository.ts` | Extracts accepted-quotation conversion into the existing firm transaction. |
| `backend/src/modules/sales-orders/index.ts` | Exports bounded order read/confirmation operations. |
| `backend/src/modules/inventory/inventory.repository.ts` | Extracts existing stock adjustment into a transaction entry point. |
| `backend/src/modules/inventory/stock-ledger.ts` | Shares read-only stock context with the original posting path; previews with existing quantity/valuation arithmetic and policy/version evidence. |
| `backend/src/modules/inventory/index.ts` | Exports adjustment and read-only preview operations. |
| `backend/src/modules/audit-logs/assistant-read.repository.ts` | Reuses audit list filtering and exposes event metadata only. |
| `backend/src/modules/audit-logs/index.ts` | Exports that projection. |
| `backend/src/bootstrap/registerRoutes.ts` | Mounts `/assistant` under the existing API router. |
| `backend/src/bootstrap/outbox-worker.ts` | Adds bounded retention cleanup to the existing worker; failures do not stop queue delivery. |
| `backend/prisma/schema.prisma` | Five assistant models and tenant/actor relationships. |
| `backend/prisma/migrations/20261109090000_wave09_business_assistant/migration.sql` | Additive tables, ownership foreign keys, deduplication constraints and query indexes. |
| `backend/prisma/migrations/20261109100000_wave09_execution_relation_unique/migration.sql` | Replaces the execution ownership index with the explicit composite unique constraint required by Prisma's one-to-one relation. |
| `backend/tests/wave09.evaluation.test.ts` | Curated routing/refusal, injected parameters, mode/plan/role/global-off/expired-grant and quota matrix. |
| `backend/tests/wave09.reports.test.ts` | Currency segmentation, exact large Decimal arithmetic and report access denial. |
| `backend/tests/wave09.stock-preview.test.ts` | Read-only stock preview, precision, reserved-stock and foreign-resource checks. |
| `backend/tests/wave09.mysql.test.ts` | Authenticated two-firm probes, fake-provider failure/timeout, quotas, retries, retention, audit rollback and confirmed financial commands. |
| `backend/tests/helpers/two-firm-fixture.ts` | Adds disposable Wave 09 database guard and cleanup of assistant fixture rows in dependency order. |
| `backend/tests/quotations.repository.test.ts` | Updates authorization mocks and covers denial at the new quotation command boundary. |
| `frontend/src/features/auth/model/permissions.ts` | Mirrors assistant permission strings. |
| `frontend/src/features/platform/AssistantModeControls.tsx` | Independent per-firm switches through the existing audited override API. |
| `frontend/src/features/platform/AssistantModeControls.test.tsx` | Selected firm/mode payload, audit reason and hard-off controls. |
| `frontend/src/features/platform/PlatformSubscriptionsPage.tsx` | Mounts those controls in the existing superadmin subscription editor. |
| `frontend/src/features/assistant/assistant.api.ts` | Existing response-envelope unwrapping and typed assistant calls. |
| `frontend/src/features/assistant/AssistantPage.tsx` | Firm/user-isolated conversation UI, cited results, draft review, explicit proposals, staging and action history. |
| `frontend/src/features/assistant/AssistantSettingsPage.tsx` | Firm-admin limits and retention consent; accurately shows the unavailable ChatGPT integration. |
| `frontend/src/features/assistant/ProposalReview.tsx` | Before/after preview, cancel/confirm and success only after server execution. |
| `frontend/src/features/assistant/ProposalReview.test.tsx` | No execution on preview, pending-state behavior and server-error reporting. |
| `frontend/src/features/assistant/index.ts` | Narrow page exports. |
| `frontend/src/shared/routing/assistantDraft.ts` | Validated browser-state handoff restricted to the same firm/user and document kind. |
| `frontend/src/shared/routing/assistantDraft.test.ts` | Precision-preserving transfer and actor/firm/kind isolation. |
| `frontend/src/shared/routing/paths.ts` | Assistant and assistant-settings paths. |
| `frontend/src/app/router/router.tsx` | Lazy assistant routes with RBAC, firm and entitlement guards. |
| `frontend/src/app/router/routeConfig.tsx` | Authorized navigation entries. |
| `frontend/src/features/quotations/pages/CreateQuotationPage.tsx` | Reviews unsaved assistant lines through the existing quotation form and save command; resets on actor/firm change. |
| `frontend/src/features/invoices/pages/InvoicesPage.tsx` | Validates draft handoff and keys the editor by actor/firm. |
| `frontend/src/features/invoices/components/InvoiceDraftForm.tsx` | Seeds unsaved lines while retaining normal address, tax, preview and save validation. |
| `backend/docs/architecture/backend/WAVE09-IMPLEMENTATION.md` | This implementation/limitation and verification report. |

## C Database migration

Five additive tables: `assistant_settings`, `assistant_conversations`, `assistant_messages`, `assistant_action_proposals`, `assistant_executions`. Existing financial records, invoices, quotations, ledgers and provider infrastructure are not backfilled or migrated.

Conversation ownership is constrained by `(id, firmId, actorId)` and a composite user/firm foreign key. Messages and proposals reference that exact owner. Executions reference the exact proposal owner. Request uniqueness is `(firmId, actorId, requestId)`; a proposal has at most one execution. Indexes support private history, firm/provider/day usage, firm request rates and retention expiry. SQL checks constrain settings and message/proposal state values. Prisma does not express the additional SQL CHECK predicates.

The user reported successfully applying `20261109090000_wave09_business_assistant`, followed by Prisma 5.22.0 generation failing with P1012 because the execution relation's complete defining key was not explicitly unique. The schema now declares `@@unique([proposalId, firmId, actorId])`. The forward migration `20261109100000_wave09_execution_relation_unique` adds the matching unique index before removing the redundant non-unique index, preserving the ownership foreign key and existing single-proposal uniqueness. The original migration remains unchanged. Existing `proposal_id` uniqueness guarantees the new composite constraint cannot conflict with existing data.

No migration or Prisma generation was executed by the assistant. Before running the changed application, apply all pending reviewed migrations to the authorized target and regenerate the client using the project's normal workflow. The integration suite only accepts a local `wave09_test_<suffix>` database with these migrations already applied; it does not apply migrations or fall back to the application's database.

For rollback, disable the two feature grants first and roll back application code while leaving the additive tables and audit evidence intact. Prefer a forward fix. No destructive down migration or financial reversal SQL is supplied.

## D API and ownership map

| API | Required access and ownership |
| --- | --- |
| `POST /api/v1/assistant/chat`, `/search` | Authenticated firm admin/user; eligible local or LLM permission/entitlement; chosen mode rechecked; every tool also checks its domain access. |
| `GET /api/v1/assistant/usage`, `/history` | Same firm context; history belongs only to the current Bhuminex actor. |
| `GET/PUT /api/v1/assistant/settings` | Firm administrator plus `assistant.settings.manage` / `firm.core`; no client-supplied tenant scope. |
| `POST /api/v1/assistant/proposals` | Exact owned conversation; active assistant mode; the existing domain action permission/feature and exact target evidence. |
| `POST /api/v1/assistant/proposals/:id/confirm` | Same firm and actor; nonce, expiry, current permission/feature, target fingerprint and original domain validation/approval. |
| `POST /api/v1/assistant/proposals/:id/cancel` | Same firm and actor, pending proposal only. |
| `DELETE /api/v1/assistant/history/:id` | Same firm and actor; erases message content, cancels pending proposals and closes the conversation. Required operational audit remains. |
| `POST /api/v1/assistant/extractions` | Local access and catalog read permission/feature; copied text only; no import or external connection. |
| Existing platform firm overrides | Superadmin only; independent `feature:assistant.local` / `feature:ai.credits` grants and denials. |

Customer/item/quotation/invoice/order/payment/audit search requires the corresponding existing view permission and feature. Drafts also require their create/manage/email permission. Net sales includes adjustment notes and therefore additionally requires billing-adjustment read access. Receivables use the existing Payments report, including reversals, allocations, adjustments and currency segmentation.

Allowed commands remain `INVOICE_ISSUE`, `INVOICE_VOID`, `CREDIT_NOTE_ISSUE`, `ORDER_CONFIRM`, `STOCK_ADJUST`, `QUOTATION_SEND` with explicit status. The assistant does not send quotation emails, record payments, delete records, change prices or expose an arbitrary command endpoint. The main assistant UI offers invoice issuance, quotation status and order creation from cited records. The remaining allowlisted commands are available through the bounded proposal API and existing product screens.

Firm-admin users may configure a shared daily request ceiling. Personal ChatGPT connections are not a firm-shared credential. The planned provider boundary is per `(firmId, actorId)`; the production adapter currently reports that commercial integration is required and makes no external calls.

## E Feature and acceptance mapping

| Specification feature | Source implementation status |
| --- | --- |
| 2.1 Record search | Implemented with conventional domain reads, bounded pages, record links, empty states and explicit selection rather than guessed mutations. Runtime NOT VERIFIED. |
| 2.2 Safe reports | Implemented through Payments receivables and Billing issued-document sales; Decimal arithmetic and independent currencies. Runtime NOT VERIFIED. |
| 2.3 Drafts | Implemented unsaved quotation/invoice handoff; follow-up/email text is reviewable and copyable for normal screens. No automated send or CRM save. Runtime NOT VERIFIED. |
| 2.4 Proposals | Implemented exact target, before/after, effects, access checks and short-lived nonce. Runtime NOT VERIFIED. |
| 2.5 Confirmed execution | Implemented for the six bounded commands with required domain approval and atomic assistant evidence. Runtime NOT VERIFIED. |
| 2.6 Audit and usage | Implemented required audit, private history, attempt metering, configurable daily cap and opt-in content retention. Live provider spend/account limits BLOCKED. |
| 2.7 Document intelligence | Copied PDF/email text staging implemented for delimited candidate lines. Raw PDF parsing/OCR, mailbox connections and general semantic extraction NOT IMPLEMENTED. |
| 2.8 Security | Strict tool schemas, no model-authored writes, trusted-origin mutations, two-layer request limits, actor/firm scope, recognized-pattern redaction and no source-document instruction execution implemented. Live-provider privacy/residency contract BLOCKED. |
| 2.9 Evaluation suite | Test sources added; all tests NOT RUN. |
| User-requested independent local/LLM toggles | Implemented via existing platform controls; both are excluded from legacy access unless explicitly granted. |
| User-requested normal ChatGPT account login | BLOCKED on approved commercial app registration and the permitted plan-usage integration contract. No working login is claimed. |
| User-requested quota fallback | Router/reservation behavior implemented and fake-provider tests authored. Live ChatGPT quota/reconnection behavior BLOCKED and NOT VERIFIED. |

Acceptance section 11 remains unaccepted: search/disambiguation, reviewed writes, adversarial scope isolation and quotas/retention have source implementations but unrun runtime gates. Provider reliability and live usage require a real approved integration. The no-autonomous-financial-write invariant is enforced by the source design; it still requires the authored runtime confirmation tests.

AI credits here mean **LLM request attempts**, not tokens, dollars or a guarantee about a ChatGPT plan balance. A credit is reserved atomically before a provider attempt; failures still count as attempts. Retries with the same request ID do not trigger another attempt. Explicit domain-tool calls and local requests do not consume AI credits. The existing platform quota is cumulative; no invented monthly reset was introduced. The firm daily attempt cap resets at 00:00 UTC. Provider rate limiting is distinct from a provider usage-limit result; no provider reset date is invented.

Conversation content defaults to off. With opt-in, recognized contact/credential patterns are redacted in stored input and the existing worker clears expired content. Redaction is not a guarantee that all PII can be identified. Source documents never enter the local intent router. Provider context is not sent at all while the commercial adapter is unavailable. Raw extracted text is not stored. Minimal usage/deduplication metadata and confirmed action evidence follow the existing operational audit policy and are not erased as conversation content.

## F Validation and deferred commands

File reads and manual execution-flow review were performed. No compiler, build, test, lint, formatter, dependency install, migration, git, Docker or deployment command was executed. No test result is reported as passing.

| Deferred command or gate | Result and reason |
| --- | --- |
| Backend `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run prisma:validate` | NOT RUN: user restriction. Prisma client generation is also deferred. |
| Frontend `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | NOT RUN: user restriction. |
| Backend focused Vitest: `npm test -- tests/wave09.evaluation.test.ts tests/wave09.reports.test.ts tests/wave09.stock-preview.test.ts tests/quotations.repository.test.ts tests/architecture/dependency-boundaries.test.ts` | NOT RUN: user restriction. |
| Backend disposable DB: `npm test -- tests/wave09.mysql.test.ts` | NOT RUN: user restriction; requires an independently migrated local `WAVE09_TEST_DATABASE_URL`. |
| Frontend focused: `npm test -- src/features/assistant/ProposalReview.test.tsx src/features/platform/AssistantModeControls.test.tsx src/shared/routing/assistantDraft.test.ts` | NOT RUN: user restriction. |
| Wave 00–08 regression and architecture suites | NOT RUN: user restriction; especially quotation status, invoice issue/void, order conversion and inventory posting consumers. |
| Live provider sign-in, refresh, quota errors, model access, revocation and regional controls | BLOCKED: commercial provider registration/contract/configuration absent. |
| Browser flow, MySQL migration validation and deployment | NOT RUN: user restriction. |

Authored negative cases include cross-firm conversations and nested IDs, same-firm actor switching, homonyms/empty searches, plan/role/global-off/suspension, unknown tools and tenant injection, missing confirmation, provider outage/timeout/invalid output, quota fallback, message retries, required-audit failure, retention erasure, stale/expired/cancelled proposals and concurrent financial confirmation. Expired-grant behavior is covered in the pure mode matrix; the integration suite separately covers active denials and suspended subscriptions. This describes test intent, not observed results.

## G Risks and release decision

**NO-GO for full Wave 09 acceptance or the next wave.** Executable checks are deferred, and live ChatGPT connection/inference is blocked.

OpenAI's [commercial client registration documentation](https://developers.openai.com/siwc/request-client-id) requires partner onboarding. The [public plan-usage guide](https://developers.openai.com/siwc/token-sharing-open-source) describes open-source/local integrations and directs paid hosted apps to commercial onboarding. [Website sign-in](https://developers.openai.com/siwc/website) is an identity flow; identity scopes alone do not establish inference permission. [Provider errors](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery) distinguish usage exhaustion from temporary availability and rate failures. These requirements still apply when end users bring their own ChatGPT accounts.

Before enabling live LLM use, obtain the approved commercial client and inference contract, confirm each-user versus delegated firm usage, configure secure server-side credential storage/rotation and consent/residency policy, and implement/verify that provider's exact authorization, refresh, revocation and quota behavior. Do not substitute the public dynamic open-source flow or a VS Code/Codex client identity in this hosted SaaS.

The existing request/usage ledger is reused; no external provider costs are silently billed to platform credentials. A future adapter must preserve per-user connections and update exhausted/revoked connection state from provider evidence without assuming that re-login resets a quota. The current unavailable adapter cannot exercise that behavior.

Raw PDF/OCR extraction and external document sources require separate implementation and approved source/quality policy. Copied-text staging is explicitly labeled in the UI. All emitted candidate data remains untrusted and is saved only through normal validated product forms.

Known assumptions are limited to the approved local provider, explicit confirmation for every supported write, external sources disabled, retention off unless a firm admin opts in, and existing platform quotas plus a firm-admin daily request ceiling. The requested change from local-only to personal ChatGPT connections is reflected in the control plane and provider boundary but is not treated as OpenAI commercial approval.
