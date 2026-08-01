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
