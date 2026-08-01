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
- `src/modules/business-settings/*`: profile, quotation settings, bank details, branding uploads
- `src/modules/categories/*`: category CRUD and audit
- `src/modules/companies/companies.repository.ts`, `company-contacts.repository.ts`, `company-addresses.repository.ts`: companies, contacts, addresses, quotation history read queries, transactional company code reservation
- `src/modules/companies/code/company-code.ts`: pure company code formatting and parsing (no Prisma)
- `src/modules/items/*`: item CRUD, code generation, image storage coupling, audit
- `src/modules/measurement-units/*`: measurement-unit CRUD and audit
- `src/modules/dashboard/*`: dashboard aggregation queries
- `src/modules/quotation-attachments/*`: attachment metadata and file lifecycle
- `src/modules/quotation-documents/*`: PDF metadata and storage tracking
- `src/modules/quotation-email/*`: communications, attachments, SMTP result tracking
- `src/modules/quotations/*`: quotation workflow, snapshots, revisions, numbering, status, and audit

There are also direct `$transaction` calls in many of those module services.

## Controller And Service Findings

Controllers still exist throughout business settings, items, quotations, quotation attachments, quotation documents, and quotation email. They mainly parse input and bridge to services, but the layer is not consistently useful everywhere.

Services currently carry the bulk of the business workflow and Prisma work in the remaining unmigrated domains. Auth, categories, dashboard, measurement units, and companies use route + repository shape; obsolete controller/service layers for completed phases were removed in BE-03A and BE-04.

## Schema And Validation Findings

- Validation is primarily Zod-based.
- Files use both `*.schema.ts` and `*.validation.ts` naming.
- Schemas are already used for body, query, and param parsing in most modules.
- Some route/controller layers still do ad hoc numeric parsing for IDs and query flags.
- Validation errors currently surface through the global error handler as `ZodError` serialization.

## Response Contract Findings

- Success responses usually use `success`, `message`, and `data`.
- The shared helpers live in `src/core/http/apiResponse.ts`.
- Some feature routes still return direct `res.status(...).json(...)` payloads instead of the shared helpers, especially in quotation email/document/attachment flows and the health fallback path.
- Response contracts must remain unchanged during migration.

## Error Handling Findings

- `AppError` is the primary operational error type.
- `ZodError` is normalized in the global error handler.
- Auth, business-settings, items, quotations, and file-storage flows all create feature-specific `AppError`s.
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
- Quotation email workflow and provider result handling remain in `src/modules/quotation-email/quotation-email.service.ts`.
- Recipient normalization, attachment selection, communication history, and status transition decisions remain feature-owned and are still mixed with SMTP orchestration in that service.

## PDF Findings

- Puppeteer launch and HTML-to-PDF generation now live in `src/integrations/pdf/pdf.service.ts`.
- Quotation-specific template rendering lives in `src/modules/quotation-documents/quotation-pdf-template.ts`.
- The document workflow still handles business profile branding data, generated-document persistence, file writing, and audit logging.

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
