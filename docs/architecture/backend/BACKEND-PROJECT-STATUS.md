# Backend Project Status

## BE-06 Status

Completed as a Settings domain route + repository migration.

Business profile, quotation settings, bank details, default-bank logic, and branding upload/delete now use route + repository + schema shape. Module renamed from `business-settings` to `settings`. Obsolete controller and service layers were removed. Branding filesystem mechanics adopted the storage integration.

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

## Starting Validation (BE-06)

- Branch: `feat/code-migration`
- Starting commit: `0c4b787fabcfda491e8109e90200beffb8fb806c`
- Lint: passed
- Typecheck: passed
- Tests: passed, 26 files / 157 tests
- Build: passed

## Final Validation (BE-06)

- Lint: passed
- Typecheck: passed
- Tests: passed, 26 files / 157 tests
- Focused Settings: `settings.repository.test.ts` (8), `settings.validation.test.ts` (8)
- Focused PDF consumer: `quotation-documents.service.test.ts` (16)
- Build: passed

## Settings Structure (After BE-06)

`src/modules/settings/`

- `index.ts` — narrow public exports (router, quotation-settings read helper, branding policy types, seed defaults)
- `settings.routes.ts` — all settings HTTP endpoints (business profile, branding, quotation settings, bank details)
- `settings.audit.ts` — settings audit wrapper
- `settings.defaults.ts` — default business profile and quotation settings seed data
- `settings.serializers.ts` — API response mapping and account masking
- `business-profile/business-profile.repository.ts` — singleton profile read/create/update
- `business-profile/business-profile.schema.ts` — profile update validation
- `quotation-settings/quotation-settings.repository.ts` — singleton quotation settings read/create/update
- `quotation-settings/quotation-settings.schema.ts` — quotation settings update validation
- `bank-details/bank-details.repository.ts` — bank CRUD, default-bank transactions, soft delete with promotion
- `bank-details/bank-details.schema.ts` — bank create/update/id validation
- `branding/branding.repository.ts` — branding asset replace/delete with compensation
- `branding/branding.policy.ts` — Multer wiring, MIME/size/extension policy, relative path mapping; uses storage integration

## Branding / Storage Decision (BE-06)

- Business policy (MIME, size, extension, naming, asset-type mapping) remains in `branding/branding.policy.ts`.
- Generic filesystem mechanics use storage integration (`ensureStorageDirectory`, `publicAssetPath`, `deleteStorageFile`, `resolveStoragePath`).
- Physical storage directories and public URL prefixes unchanged (`logos`, `signatures`, `stamps` under `/storage/`).

## Public Settings Boundary (BE-06)

- `settingsRouter` — mounted at `/api/v1/settings`
- `getOrCreateQuotationSettings()` — used by `quotation-number.service.ts`
- `brandingAssetConfig`, `resolveBrandingPath`, `BrandingAssetType` — used by `quotation-documents.service.ts`
- `defaultBusinessProfileData`, `defaultQuotationSettingsData` — used by seed

## Controllers/Services Removed (BE-06)

- `business-settings.controller.ts`
- `business-profile.service.ts`
- `quotation-settings.service.ts`
- `bank-details.service.ts`
- `branding-assets.service.ts`
- `branding-upload.ts` (replaced by `branding/branding.policy.ts`)
- `business-settings.validation.ts` (replaced by capability schemas)
- `business-settings.routes.ts`
- entire `business-settings/` folder

## API Compatibility

All `/api/v1/settings` routes, contracts, messages, and status codes preserved.

## Deferred Work

- Move remaining `AppError` throws from Settings repositories into routes where practical (optional refactor).
- Quotation PDF/email still query business profile and bank details via direct Prisma in quotation-documents service (revisit in BE-07).
- Narrow cross-module settings read helpers for PDF/email when Quotations migrates (BE-07).

## Current Architecture Summary

Auth, categories, dashboard, measurement units, companies, items, and settings use route + repository shape. Quotations, quotation documents, quotation email, and quotation attachments still use controller/service layers.

## Target Architecture Summary

Route + repository by default; schemas own validation; integrations own provider mechanics; core stays business-neutral.

## Main Risks

- Quotations remains the largest coupled domain.
- Quotation documents still use direct Prisma for business profile and bank details reads.
- Some external-infrastructure behaviour remains embedded in unmigrated quotation feature services.

## Readiness Result

READY WITH CONDITIONS

Conditions: preserve API contracts; migrate Quotations domain in BE-07.

## Next Phase

BE-07 — Unified Quotation Domain

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

Auth, categories, dashboard, measurement units, companies, items, and settings use route + repository shape. Business settings, quotations, quotation documents, quotation email, and quotation attachments still use controller/service layers.

## Target Architecture Summary

Route + repository by default; schemas own validation; integrations own provider mechanics; core stays business-neutral.

## Main Risks

- Quotations remains the largest coupled domain.
- Quotation documents still use direct Prisma for business profile and bank details reads.
- Some external-infrastructure behaviour remains embedded in unmigrated quotation feature services.

## Readiness Result

READY WITH CONDITIONS

Conditions: preserve API contracts; migrate remaining domains in planned phases.

## Next Phase

BE-07 — Unified Quotation Domain
