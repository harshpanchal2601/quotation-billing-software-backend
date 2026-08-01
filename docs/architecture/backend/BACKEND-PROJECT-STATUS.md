# Backend Project Status

## BE-05 Status

Completed as an Items domain route + repository migration.

Items CRUD, options, status, restore, item code generation, and item image upload/delete now use route + repository + schema shape. Obsolete controller and service layers were removed. Item image filesystem mechanics adopted the storage integration.

## BE-04 Status

Completed as a Companies domain route + repository migration.

Companies, contacts, addresses, company code generation, and company quotation history now use route + repository + schema shape. Obsolete controller and service layers were removed.

## BE-03A Status

Completed as an obsolete-file cleanup.

BE-03A removed completed-phase controller/service layers and placeholder folders that were superseded by BE-02 and BE-03.

## BE-02 Status

Completed as a foundation migration.

The backend now has typed config modules for mail, PDF, and storage; integration ownership for mail/PDF/storage mechanics; a business-neutral database health helper; and auth middleware moved out of Core into the auth module.

## Starting Validation (BE-05)

- Branch: `feat/code-migration`
- Starting commit: `86ed2bfdbb706067fe10ca5778ce2b2e84912119`
- Lint: passed
- Typecheck: passed
- Tests: passed, 24 files / 149 tests
- Build: passed

## Final Validation (BE-05)

- Lint: passed
- Typecheck: passed
- Tests: passed, 26 files / 157 tests
- Focused Items: `items.repository.test.ts` (9), `item-code.test.ts` (3), `item-image.policy.test.ts` (4)
- Build: passed

## Catalog Parent Decision (BE-05)

No Catalog parent module created. Categories remain at `src/modules/categories/`, measurement units at `src/modules/measurement-units/`, and items at `src/modules/items/`. The three modules do not share a meaningful combined public boundary that would justify path churn.

## Items Structure (After BE-05)

`src/modules/items/`

- `index.ts` — public router export
- `items.routes.ts` — HTTP workflow for item CRUD, options, status, restore, image upload/delete
- `items.repository.ts` — item persistence, category/unit validation, code generation with retry, image metadata, quotation usage counts
- `items.schema.ts` — request/query validation
- `items.serializer.ts` — API response mapping
- `items.types.ts` — pagination and relation types
- `item-specifications.ts` — specification validation
- `code/item-code.ts` — pure formatting and sequence parsing helpers
- `images/item-image.policy.ts` — Multer wiring, MIME/size/extension policy, relative path mapping
- `images/index.ts` — narrow image policy exports

## Item Code Decision

- Pure formatting and sequence parsing live in `code/item-code.ts`.
- Database lookup and retry-on-conflict live in `items.repository.ts` (max 5 attempts).
- Prefix `ITEM-`, six-digit padding, and concurrency protection unchanged.

## Item Image / Storage Decision

- Business policy (MIME, size, extension, naming) remains in `images/item-image.policy.ts`.
- Generic filesystem mechanics use storage integration (`ensureStorageDirectory`, `publicAssetPath`, `deleteStorageFile`).
- Single image per item (stored in `imagePath` field); no primary-image concept.
- Physical storage directory and public URL prefix unchanged.

## Category / Unit Boundary Decision

- Items repository queries `itemCategory` and `measurementUnit` Prisma models directly for existence and active checks.
- No cross-module category or measurement unit repository imports.

## Controllers/Services Removed (BE-05)

- `items.controller.ts`
- `items.service.ts`
- `item-code.service.ts`
- `item-image.service.ts`
- `items.validation.ts` (replaced by `items.schema.ts`)
- `.gitkeep`

## API Compatibility

All `/api/v1/items` routes, contracts, messages, and status codes preserved.

## Deferred Work

- Move remaining `AppError` throws from Items repository into routes where practical (optional refactor).
- Narrow cross-module item read helpers when Quotations migrates (BE-07).

## Current Architecture Summary

Auth, categories, dashboard, measurement units, companies, and items use route + repository shape. Business settings, quotations, quotation documents, quotation email, and quotation attachments still use controller/service layers.

## Target Architecture Summary

Route + repository by default; schemas own validation; integrations own provider mechanics; core stays business-neutral.

## Main Risks

- Quotations remains the largest coupled domain.
- Business settings still mixes workflow, storage, and Prisma in services.
- Some external-infrastructure behaviour remains embedded in unmigrated feature services.

## Readiness Result

READY WITH CONDITIONS

Conditions: preserve API contracts; migrate remaining domains in planned phases.

## Next Phase

BE-06 — Settings Domain
