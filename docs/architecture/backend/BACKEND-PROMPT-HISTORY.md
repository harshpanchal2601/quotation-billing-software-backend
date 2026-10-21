# Prompt History

## BE-01 — Backend Architecture Audit and Migration Map

- Audit scope: backend-only architecture audit for current routes, modules, core, integrations, validation, storage, Prisma usage, tests, and migration targets.
- Validation: lint passed, typecheck passed, tests passed, build passed.
- Main findings: current implementation is stable but still controller/service heavy; quotations is the largest and most coupled domain; Prisma calls are concentrated in feature services and a few controllers; core auth still imports auth-module constants/token helpers.
- Target model: route + repository is the default; schemas own validation; integrations own mail/PDF/storage mechanics; config owns env parsing; core remains business-neutral.
- Risk summary: critical quotation work, high-risk auth/company/settings/storage areas, and current mail/PDF/storage leakage into feature services.
- Readiness result: READY WITH CONDITIONS.
- Next phase: BE-02 — Bootstrap, Core, Config, and Integrations Foundation.

## BE-03A — Completed-Phase Obsolete File and Folder Cleanup

- Scope: remove obsolete completed-phase controller/service layers, compatibility files, and placeholder folders.
- Deleted architecture leftovers: old auth controller/service, old categories controller/service, old dashboard controller/service, old measurement-units controller/service, and empty top-level placeholder folders.
- Retained compatibility files: none.
- Validation: lint, typecheck, tests, and build all passed after cleanup.
- Behaviour preservation: no API, token, cookie, status, or dashboard/category/unit behavior changed.
- Next phase: BE-04 — Companies Domain.

## BE-04 — Companies Domain Route + Repository Migration

- Scope: companies CRUD, contacts, addresses, company code generation, company quotation history, audit preservation.
- Main structural changes: removed controller and three service layers; added `companies.repository.ts`, `company-contacts.repository.ts`, `company-addresses.repository.ts`, renamed validation to `companies.schema.ts`, added `code/company-code.ts` and `index.ts`; consolidated HTTP handlers in `companies.routes.ts`.
- Transaction decisions: unchanged — company create with nested records and code generation in one transaction; contact/address primary changes and soft-delete promotion in repository transactions; audit after commit via shared audit helper.
- Cleanup: deleted obsolete controller, services, validation file, and `.gitkeep`; renamed `companies.service.test.ts` to `companies.repository.test.ts`; added `company-code.test.ts`.
- Behaviour preservation: API paths, payloads, pagination, search/filter/sort, primary contact and per-type primary address rules, quotation delete guard, soft delete/restore, code format and retry unchanged.
- Validation: baseline and final lint, typecheck, test (149), build passed.
- Deferred work: optional route-level conflict/not-found refactor for Companies repositories; Quotations cross-module read boundary in BE-07.
- Next phase: BE-05 — Catalog and Items Domain.

## BE-05 — Catalog and Items Domain Route + Repository Migration

- Scope: items CRUD, options, status, restore, item code generation, item image upload/delete, audit preservation.
- Catalog decision: no Catalog parent; categories, measurement units, and items remain separate modules.
- Main structural changes: removed controller and two service layers; added `items.repository.ts`, renamed validation to `items.schema.ts`, added `code/item-code.ts`, `images/item-image.policy.ts`, and `index.ts`; consolidated HTTP handlers in `items.routes.ts`.
- Item code: pure formatting in `code/item-code.ts`; database sequence lookup and retry in `items.repository.ts` (max 5 attempts, `ITEM-` prefix, six-digit padding unchanged).
- Image/Storage: MIME/size/extension policy and Multer wiring in `images/item-image.policy.ts`; adopted storage integration for directory ensure and file delete; paths and public URLs unchanged.
- Category/Unit boundary: Items repository queries category and measurement unit Prisma models directly.
- Cleanup: deleted obsolete controller, services, validation file, and `.gitkeep`; renamed `items.service.test.ts` to `items.repository.test.ts`; added `item-code.test.ts` and `item-image.policy.test.ts`.
- Behaviour preservation: API paths, payloads, pagination, search/filter/sort, soft delete/restore, image upload/delete, code format and retry, category/unit rules unchanged.
- Validation: baseline and final lint, typecheck, test (157), build passed.
- Deferred work: optional route-level conflict refactor; Quotations cross-module read boundary in BE-07.
- Next phase: BE-06 — Settings Domain.

## BE-07 — Unified Quotation Domain Route + Repository Migration

- Scope: consolidate quotation CRUD, calculations, numbering, revisions, status, PDF, attachments, email, communication history, and audit into `src/modules/quotations/`.
- Cleanup: removed top-level quotation documents, attachments, email, controller, service, validation, and helper files after responsibilities moved.
- Boundary result: routes use repositories/integrations; repositories own Prisma; Settings exposes narrow quotation read helpers.
- Validation: typecheck, tests, and build passed after migration.
- Next phase: BE-08 — Tests, Storage, Cleanup, and Dependency-Boundary Enforcement.

## BE-08 — Tests, Storage, Cleanup, and Dependency-Boundary Enforcement

- Scope: final backend architecture hardening after BE-07; no API or business behaviour changes.
- Cleanup: removed rejected source/test placeholder `.gitkeep` files and empty rejected folders; runtime storage placeholders retained.
- Test organization: renamed legacy service-named tests to repository, policy, template, and communication ownership names.
- Storage result: no physical storage files changed; item/branding public paths and quotation PDF/attachment protected paths preserved.
- Boundary enforcement: added Vitest architecture tests for Core/Config/Integration independence, route Prisma prohibition, repository/schema boundaries, provider ownership, environment ownership, narrow barrels, and rejected folders.
- Validation: lint, typecheck, tests, architecture test, and build passed.
- Retained exceptions: bootstrap Prisma disconnect, core database health query, upload file namespace types, and narrow Settings read helpers for Quotations.
- Next phase: BE-09 final acceptance audit.
