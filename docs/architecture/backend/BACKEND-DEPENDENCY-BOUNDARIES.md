# Dependency Boundaries

## Allowed Direction

- bootstrap → modules → core → config
- modules may also import integrations
- repositories may import core database helpers and narrowly scoped module-local helpers
- integrations may import config and core errors/logging

## Current Violations Found

- `src/modules/auth/auth.middleware.ts` owns authentication middleware and token verification boundary usage; Core no longer imports auth-module internals for this flow.

## Removed Compatibility Paths

- `src/core/auth/authentication.middleware.ts` removed after BE-02 cleanup.
- `src/modules/auth/auth.controller.ts` removed in BE-03A.
- `src/modules/auth/auth.service.ts` removed in BE-03A.
- `src/modules/categories/categories.controller.ts` removed in BE-03A.
- `src/modules/categories/categories.service.ts` removed in BE-03A.
- `src/modules/dashboard/dashboard.controller.ts` removed in BE-03A.
- `src/modules/dashboard/dashboard.service.ts` removed in BE-03A.
- `src/modules/measurement-units/measurement-units.controller.ts` removed in BE-03A.
- `src/modules/measurement-units/measurement-units.service.ts` removed in BE-03A.
- `src/modules/companies/companies.controller.ts` removed in BE-04.
- `src/modules/companies/companies.service.ts` removed in BE-04.
- `src/modules/companies/company-contacts.service.ts` removed in BE-04.
- `src/modules/companies/company-addresses.service.ts` removed in BE-04.
- `src/modules/companies/company-code.service.ts` removed in BE-04.
- `src/modules/items/items.controller.ts` removed in BE-05.
- `src/modules/items/items.service.ts` removed in BE-05.
- `src/modules/items/item-code.service.ts` removed in BE-05.
- `src/modules/items/item-image.service.ts` removed in BE-05.

## Companies Public API (BE-04)

- Export: `companiesRouter` from `src/modules/companies/index.ts`.
- Consumer: `src/bootstrap/registerRoutes.ts` mounts `/api/v1/companies`.
- No cross-module Companies repository imports today; Quotations does not import Companies internals for persistence.

## Items Public API (BE-05)

- Export: `itemsRouter` from `src/modules/items/index.ts`.
- Consumer: `src/bootstrap/registerRoutes.ts` mounts `/api/v1/items`.
- No cross-module Items imports today; Quotations does not import Items internals.
- Category/unit checks: Items repository queries category and measurement unit Prisma models directly (intentional Item-owned dependency query, not full repository exposure).

## Boundary Notes

- Config must not import modules.
- Core must not import feature modules.
- Modules should not import another module’s internal repository directly unless it is an intentional public boundary.
- Shared functionality should stay business-neutral in core; feature wording and workflow should stay in modules.

## BE-08 Enforced Boundaries

Enforcement lives in `tests/architecture/dependency-boundaries.test.ts`.

Rules enforced:

- Core, Config, and Integrations must not import business modules.
- Route files must not import the Prisma client or contain raw database access markers.
- Repository files must not import Express.
- Schema files must not import repositories, Prisma client ownership, or integrations.
- `process.env` reads must stay in `src/config/env.ts`.
- Nodemailer must stay under `src/integrations/mail`.
- Puppeteer must stay under `src/integrations/pdf`.
- Top-level module indexes must not use `export *`.
- Rejected architecture folders must remain absent.

Intentional exceptions:

- `src/bootstrap/server.ts`: imports Prisma only to disconnect cleanly on shutdown; infrastructure-owned and permanent.
- `src/core/database/database-health.ts`: performs `SELECT 1` health query; core database health and permanent.
- Upload-capable repositories use `Express.Multer.File` namespace types without importing Express; temporary until a shared upload file type is useful.
- Quotation modules import Settings through narrow public helpers for quotation numbering, PDF branding, and email business profile reads; permanent narrow read boundary.
