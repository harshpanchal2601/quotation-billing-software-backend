# Backend Architecture Audit

## Safety Checkpoint

- Git branch: `feat/code-migration`
- Current commit: `308cd35`
- Working tree: dirty during BE-03A cleanup
- Merge conflicts: none detected from the working tree state
- Uncommitted files: BE-03A cleanup changes in progress

## Baseline Validation

- Lint: passed
- Typecheck: passed
- Tests: passed, 20 files / 143 tests
- Build: passed

## Current Top-Level Structure

Current source folders:

- `src/bootstrap`: app creation, route registration, server startup
- `src/config`: environment parsing
- `src/core`: Prisma client, HTTP helpers, errors, audit, database health
- `src/integrations`: mail, PDF, storage provider mechanics
- `src/modules`: business domains and feature helpers
- `src/routes`: standalone route modules such as health
- `tests`: service, validation, auth, health, storage, PDF, email, quotations, and seed tests
- `storage`: runtime asset and generated-file root

Current source-tree reality:

- Actual feature work lives in `src/modules/*` and the top-level placeholder `controllers`, `services`, `templates`, and `validators` folders were removed in BE-03A.
- The backend already has a route registry in `src/bootstrap/registerRoutes.ts`.
- Runtime storage is tracked under `storage/` with committed sample files and `.gitignore` rules for generated artifacts.

## Current Entry Points

- App creation: `src/bootstrap/app.ts`
- Server startup and shutdown: `src/bootstrap/server.ts`
- Route mounting: `src/bootstrap/registerRoutes.ts`
- Health route module: `src/routes/health.routes.ts`

## Route Ownership

- `/api/v1/auth`: auth login, refresh, logout, me, change password
- `/api/v1/settings`: business profile, branding uploads, quotation settings, bank details
- `/api/v1/companies`: companies, contacts, addresses, quotation history
- `/api/v1/categories`: category CRUD and options
- `/api/v1/measurement-units`: measurement-unit CRUD and options
- `/api/v1/items`: item CRUD and image upload/delete
- `/api/v1/quotations`: quotation CRUD, calculation preview, revisions, PDF, attachments, email, history
- `/api/v1/dashboard`: dashboard overview
- `/api/v1/health`: API and database health

## Middleware And Error Ownership

- Middleware registration happens in `src/bootstrap/app.ts`.
- Authentication middleware now lives in `src/modules/auth/auth.middleware.ts`.
- Global error handling lives in `src/core/http/errorHandler.ts`.
- Not-found handling lives in `src/core/http/notFoundHandler.ts`.
- Async wrapper lives in `src/core/http/asyncHandler.ts`.

## Config And Environment Findings

- Environment parsing is centralized in `src/config/env.ts`.
- `dotenv.config()` is executed there.
- Required secrets and service settings are validated with Zod.
- Feature code still reads config from `env` in multiple places, but the actual parsing entry point is centralized.

## Direct Prisma Findings

Prisma usage is concentrated in:

- `src/core/database/prisma.ts`: Prisma client ownership
- `src/modules/auth/auth.middleware.ts`: user lookup for authenticated requests
- `src/routes/health.routes.ts`: database health query
- `src/modules/auth/*`: auth workflow, sessions, password change, audit logging
- `src/modules/settings/*`: profile, quotation settings, bank details, branding uploads
- `src/modules/categories/*`: category CRUD and audit
- `src/modules/companies/companies.repository.ts`, `company-contacts.repository.ts`, `company-addresses.repository.ts`: companies, contacts, addresses, quotation history read queries, transactional company code reservation
- `src/modules/companies/code/company-code.ts`: pure company code formatting and parsing (no Prisma)
- `src/modules/items/items.repository.ts`: item CRUD, code generation with retry, category/unit validation, image metadata, quotation usage counts, audit
- `src/modules/items/code/item-code.ts`: pure item code formatting and parsing (no Prisma)
- `src/modules/items/images/item-image.policy.ts`: MIME/size/extension policy and Multer wiring (uses storage integration for filesystem mechanics)
- `src/modules/measurement-units/*`: measurement-unit CRUD and audit
- `src/modules/dashboard/*`: dashboard aggregation queries
- `src/modules/quotations/attachments/*`: attachment metadata and file lifecycle
- `src/modules/quotations/documents/*`: PDF metadata and storage tracking
- `src/modules/quotations/communications/*`: communications, attachments, SMTP result tracking
- `src/modules/quotations/*`: quotation workflow, snapshots, revisions, numbering, status, and audit

Direct `$transaction` calls are repository-owned.

## Controller And Service Findings

No production controller files remain.

No production service files remain. Auth, categories, dashboard, measurement units, companies, items, settings, and quotations use route + repository shape.

## Schema And Validation Findings

- Validation is primarily Zod-based.
- Production validation files use `*.schema.ts` naming.
- Schemas are already used for body, query, and param parsing in most modules.
- Some routes still do local numeric parsing where that preserves existing response messages.
- Validation errors currently surface through the global error handler as `ZodError` serialization.

## Response Contract Findings

- Success responses usually use `success`, `message`, and `data`.
- The shared helpers live in `src/core/http/apiResponse.ts`.
- Some feature routes still return direct `res.status(...).json(...)` payloads instead of the shared helpers, especially in quotation email/document/attachment flows and the health fallback path.
- Response contracts must remain unchanged during migration.

## Error Handling Findings

- `AppError` is the primary operational error type.
- `ZodError` is normalized in the global error handler.
- Auth, settings, items, quotations, and file-storage flows all create feature-specific `AppError`s.
- Some integrations log and rethrow generic failures rather than using specialized integration error classes.

## Core Boundary Findings

Confirmed violation:

- `src/core/auth/authentication.middleware.ts` imported auth-module constants and token verification from `src/modules/auth/*`.

This was the clearest current core-to-module dependency and was addressed in the foundation phase by moving the middleware into `src/modules/auth/auth.middleware.ts`, then removing the old Core file in BE-02 cleanup.

## Auth Findings

- Login, refresh, logout, current user, and password change are implemented in `src/modules/auth`.
- Auth now uses `src/modules/auth/auth.routes.ts` plus `src/modules/auth/auth.repository.ts` and focused security helpers.
- Token creation/verification lives in `src/modules/auth/security/auth.tokens.ts`.
- Cookie behavior lives in `src/modules/auth/security/auth.cookies.ts`.
- Rate limiting for login lives in `src/modules/auth/security/auth.rate-limit.ts`.
- Auth currently owns session persistence, refresh rotation, password hashing, and audit logging.
- Core authentication middleware no longer depends on auth-module internals for this flow.

## Mail Findings

- Nodemailer transport creation now lives in `src/integrations/mail/mail.service.ts`.
- Quotation email workflow and provider result handling live in `src/modules/quotations/communications/quotation-communications.repository.ts`.
- Recipient normalization, attachment selection, communication history, and status transition decisions remain quotation-owned; SMTP mechanics remain integration-owned.

## PDF Findings

- Puppeteer launch and HTML-to-PDF generation now live in `src/integrations/pdf/pdf.service.ts`.
- Quotation-specific template rendering lives in `src/modules/quotations/documents/quotation-document.template.ts`.
- The document workflow uses PDF and Storage integrations while quotation document metadata/audit persistence remains repository-owned.

## Storage Findings

- Runtime storage root is `storage/`.
- Public asset serving is now exposed from `src/integrations/storage/*`.
- Branding uploads, item images, quotation attachments, and generated quotation PDFs all use storage-specific helpers.
- Path traversal checks exist in multiple places, but storage behavior is still spread across several feature files.

## Audit Logging Findings

- Shared audit support lives in `src/core/audit/audit-log.service.ts`.
- Feature modules use audit logs for create/update/delete/status transitions and file lifecycle events.
- Quotation email, PDF generation, item image, and branding flows also write audit entries.

## Public Boundary Findings

- Auth, categories, dashboard, and measurement-units expose narrow public `index.ts` files.
- The rest of the module tree is consumed via direct relative imports.
- There is no sign of self-importing module indexes in the current tree.

## Module-Level Classification

Auth: route + repository + security helpers; old controller/service layers removed in BE-03A.

Dashboard: route + repository; old controller/service layers removed in BE-03A.

Categories: route + repository; old controller/service layers removed in BE-03A.

Measurement units: route + repository; old controller/service layers removed in BE-03A.

Companies: migrated in BE-04 to route + repository; contacts and addresses use dedicated repositories at module root (no separate route subfolders).

Items: keep temporarily; image handling and code generation need careful migration.

Business settings: keep temporarily; profile, quotation settings, bank details, and branding should be split by capability.

Quotations: keep temporarily; this is the critical domain and should migrate last among business areas.

Quotation documents: move to integrations/pdf mechanics plus quotation document capability later.

Quotation email: move to integrations/mail mechanics plus quotation communications capability later.

Quotation attachments: move toward storage integration plus quotation attachments capability later.

## Risk Summary

- Low: docs, indexes, explicit export cleanup
- Medium: bootstrap, core, config foundation, categories, measurement units, dashboard
- High: auth, companies, items, business settings, storage abstraction
- Critical: quotations, PDF, email, attachments, revisions, status transitions, document history, communication history

## Readiness Decision

READY WITH CONDITIONS

Conditions:

- Preserve every public API contract.
- Treat quotations as a dedicated critical stream in later phases.
- Separate the foundation work from feature migrations.

## BE-08 Audit Update

- Safety checkpoint: branch `feat/code-migration`, commit `a0c10362cea30ccc7b26abf0b8c96f0c920c3e56`, clean working tree before BE-08, no conflict markers.
- Baseline after test-isolation fix: lint passed, typecheck passed, tests passed (`26` files / `157` tests), build passed.
- Active production tree: `bootstrap`, `config`, `core`, `integrations`, `modules`, `routes`, `types`.
- Active modules: auth, categories, companies, dashboard, items, measurement-units, quotations, settings.
- Controllers found in production source: none.
- Services found in production source: none.
- Obsolete source placeholders removed in BE-08: `src/controllers`, `src/services`, `src/templates`, `src/validators`, `src/core/auth`, `src/core/mail`, `src/core/storage`, `src/modules/addresses`, `src/modules/audit-logs`, `src/modules/contacts`, `src/modules/pdf`, `src/modules/units`, `src/modules/users`, `src/modules/business-settings`.
- Runtime storage placeholders retained: `storage/attachments`, `storage/items`, `storage/logos`, `storage/quotations`, `storage/signatures`, `storage/stamps`.
- Direct Prisma ownership: module database work is repository-owned; bootstrap shutdown and core health/database ownership remain intentional infrastructure exceptions.
- Route Prisma result: no production route imports the Prisma client or performs raw Prisma/database operations.
- Integration ownership result: Nodemailer remains in Mail integration; Puppeteer remains in PDF integration; generic storage mechanics remain in Storage integration.
- Remaining filesystem exceptions: quotation PDF route streams protected files, attachment route cleans failed Multer uploads, quotation communications checks selected file sizes before email.
- Public module exports are narrow and explicit; no module `export *` barrels remain.
- Test tree after BE-08 cleanup includes architecture, route, repository, schema, middleware, policy, template, env, health, seed, and public-storage tests.
