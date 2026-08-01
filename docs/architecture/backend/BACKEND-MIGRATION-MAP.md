# Backend Migration Map

## Status Legend

- Keep
- Move
- Merge
- Split
- Rename
- Replace
- Review
- Remove later
- Not applicable

## Current-To-Target Map

| Current path | Current responsibility | Target path | Target responsibility | Action | Dependencies | Risk | Migration phase | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| `src/bootstrap/app.ts` | Express app composition, middleware registration, static storage mounting | `src/bootstrap/createApp.ts` and friends | Bootstrap composition split | Review | core, config, integrations | Medium | BE-02 | smoke / baseline | Keep |
| `src/bootstrap/registerRoutes.ts` | API route mounting | `src/bootstrap/registerRoutes.ts` or split registration helpers | Route registration | Keep then refine | modules | Low | BE-02 | route smoke | Keep |
| `src/bootstrap/server.ts` | Server startup and shutdown | `src/bootstrap/startServer.ts` | Server start lifecycle | Rename | core/database | Low | BE-02 | build/typecheck | Review |
| `src/config/env.ts` | Env parsing and config typing | `src/config/*.config.ts` later | Config parsing and typed provider settings | Split | none | Medium | BE-02 | env tests | Keep |
| `src/core/database/prisma.ts` | Shared Prisma client | `src/core/database/prisma.ts` | Shared Prisma client | Keep | config | Low | BE-02 | baseline | Keep |
| `src/core/auth/authentication.middleware.ts` | Auth middleware and role guard | `src/modules/auth/auth.middleware.ts` | Business-neutral auth middleware | Move | auth module, core errors | High | BE-02 | auth middleware tests | Move |
| `src/core/http/*` | Async, response, not-found, error handling | `src/core/http/*` | Business-neutral HTTP helpers | Keep | none | Low | BE-02 | baseline | Keep |
| `src/core/audit/audit-log.service.ts` | Audit persistence helper | `src/core/audit/audit-log.service.ts` | Shared audit helper | Keep | Prisma client | Low | BE-02 | service tests | Keep |
| `src/core/mail/mail-transport.service.ts` | Nodemailer transport | `src/integrations/mail/*` | Mail provider mechanics | Move | config | High | BE-02 | mocked mail tests | Move |
| `src/core/storage/public-assets.ts` | Public static storage serving | `src/integrations/storage/*` plus bootstrap wiring | Storage serving mechanics | Move | config | High | BE-02 | public-assets tests | Move |
| `src/routes/health.routes.ts` | Health endpoints | `src/routes/health.routes.ts` or `modules/health` if needed | Health and database check | Review | core/database | Low | BE-02 | health tests | Keep |
| `src/modules/auth/auth.routes.ts` | Auth HTTP routes | `src/modules/auth/auth.routes.ts` | Auth workflow orchestration | Keep | auth schema, core auth, auth service/repository | High | BE-03 | auth tests | Keep |
| `src/modules/auth/auth.controller.ts` | Auth HTTP/controller bridge | `src/modules/auth/auth.routes.ts` | Route orchestration | Merge | auth service, schemas | High | BE-03 | auth tests | Merge |
| `src/modules/auth/auth.service.ts` | Login/session/password workflow, Prisma, audit | `src/modules/auth/auth.repository.ts` plus route orchestration | Auth repository and workflow split | Split | core auth, config, audit | High | BE-03 | auth service tests | Split |
| `src/modules/categories/*` | Category CRUD, validation, audit | `src/modules/categories/categories.routes.ts`, `categories.repository.ts`, `categories.schema.ts` | Route + repository + schema | Split | core, audit | Medium | BE-03 | categories tests | Split |
| `src/modules/measurement-units/*` | Measurement-unit CRUD, validation, audit | `src/modules/measurement-units/*` | Route + repository + schema | Split | core, audit | Medium | BE-03 | measurement-unit tests | Split |
| `src/modules/dashboard/*` | Dashboard aggregation | `src/modules/dashboard/dashboard.routes.ts` + repository/helper | Route + repository | Review | Prisma, core | Medium | BE-03 | dashboard tests | Review |
| `src/modules/companies/*` | Companies, contacts, addresses, quotation history | `src/modules/companies/*` plus subfolders for contacts/addresses/code | Route + repository + capability split | Split | audit, core, quotations summaries | High | BE-04 | companies tests | Split |
| `src/modules/items/*` | Items, code, image policy, validation, audit | `src/modules/items/*` plus `images/` and `code/` capability folders | Route + repository + feature helpers | Split | integrations/storage, audit, categories, units | High | BE-05 | items tests | Split |
| `src/modules/business-settings/*` | Business profile, quotation settings, bank details, branding | `src/modules/settings/*` | Settings domain split by capability | Split | storage integration, audit, quotations defaults | High | BE-06 | business-settings tests | Split |
| `src/modules/quotations/*` | Quotation CRUD, calculations, numbering, snapshot, status, revisions | `src/modules/quotations/*` capability tree | Unified quotation domain | Split | companies, items, settings, audit, core | Critical | BE-07 | quotations tests | Split |
| `src/modules/quotation-documents/*` | PDF generation, document history, preview/download | `src/integrations/pdf/*` and later quotations/documents capability | PDF provider mechanics and document workflow split | Split | integrations/storage, settings, quotations | Critical | BE-07 | quotation-documents tests | Split |
| `src/modules/quotation-email/*` | Quotation email workflow, communications, SMTP interaction | `src/integrations/mail/*` and later quotations/communications capability | Mail provider mechanics and communication workflow split | Split | integrations/storage, settings, quotations | Critical | BE-07 | quotation-email tests | Split |
| `src/modules/quotation-attachments/*` | Attachment upload, download, preview, delete | `src/integrations/storage/*` and later quotations/attachments capability | Storage mechanics and attachment workflow split | Split | integrations/storage, quotations | Critical | BE-07 | quotation-attachments tests | Split |
| `src/modules/*/*.schema.ts` and `*.validation.ts` | Request validation | Co-located or renamed to consistent `*.schema.ts` later | Schema-owned validation | Review | routes | Medium | BE-02 onward | validation tests | Review |
| `storage/*` | Runtime assets and generated files | keep runtime storage, but integrate safely | External file roots | Review | storage integration | High | BE-08 | storage tests | Keep |

## Phase Map

### BE-01 — Backend Architecture Audit and Migration Map

- Scope: audit only, no production changes
- Exclusions: source migrations, Prisma, routes, packages, tests, env, storage, deployment
- Dependencies: none
- Risk: low
- Required tests: baseline only
- Rollback point: none needed because no production changes
- Acceptance: current state mapped and target clear

### BE-02 — Bootstrap, Core, Config, and Integrations Foundation

- Scope: foundation layer only
- Exclusions: business domain migrations
- Dependencies: BE-01
- Risk: medium
- Required tests: baseline regression, foundation smoke tests
- Rollback point: pre-foundation commit
- Acceptance: core/config/integrations boundaries are explicit

### BE-03 — Auth, Dashboard, Categories, and Measurement Units

- Scope: auth plus the smaller master-data domains
- Exclusions: companies, items, settings, quotations
- Dependencies: BE-02
- Risk: auth is high; categories and measurement units are medium
- Required tests: auth and domain behavior tests
- Rollback point: pre-domain migration commit
- Acceptance: routes orchestrate, repositories own Prisma

### BE-04 — Companies Domain

- Scope: companies, contacts, addresses, company-code ownership
- Exclusions: items, settings, quotations
- Dependencies: BE-03
- Risk: high
- Required tests: company CRUD/history/relationship tests
- Rollback point: pre-companies migration commit
- Acceptance: company capability split is stable

### BE-05 — Catalog and Items Domain

- Scope: items, categories/measurement-unit dependencies, item code, item images
- Exclusions: settings, quotations
- Dependencies: BE-04
- Risk: high
- Required tests: item CRUD and image/storage regression tests
- Rollback point: pre-items migration commit
- Acceptance: item workflow and image handling are separated cleanly

### BE-06 — Settings Domain

- Scope: business profile, quotation settings, bank details, branding
- Exclusions: quotation core logic
- Dependencies: BE-05
- Risk: high
- Required tests: settings and branding regression tests
- Rollback point: pre-settings migration commit
- Acceptance: settings access for quotations is stable

### BE-07 — Unified Quotation Domain

- Scope: quotation CRUD, calculations, numbering, revisions, status, attachments, documents, communications, history
- Exclusions: none inside quotation domain
- Dependencies: BE-06
- Risk: critical
- Required tests: quotation calculation, revision, status, PDF, email, attachment, and history regression tests
- Rollback point: pre-quotation migration commit
- Acceptance: critical quotation behavior preserved exactly

### BE-08 — Tests, Storage, Cleanup, and Boundary Enforcement

- Scope: testing refinements, storage cleanup, boundary hardening
- Exclusions: business feature changes
- Dependencies: BE-07
- Risk: high
- Required tests: storage, boundary, regression, and any added contract tests
- Rollback point: pre-cleanup commit
- Acceptance: storage and boundaries are enforced without contract drift

### BE-09 — Final Backend Regression Audit

- Scope: full backend review and release readiness check
- Exclusions: new feature work
- Dependencies: BE-08
- Risk: medium
- Required tests: full backend baseline plus targeted regressions
- Rollback point: last pre-release commit
- Acceptance: final architecture matches target and contracts remain intact
