# Backend Project Status

## BE-04 Status

Completed as a Companies domain route + repository migration.

Companies, contacts, addresses, company code generation, and company quotation history now use route + repository + schema shape. Obsolete controller and service layers were removed.

## BE-03A Status

Completed as an obsolete-file cleanup.

BE-03A removed completed-phase controller/service layers and placeholder folders that were superseded by BE-02 and BE-03.

## BE-02 Status

Completed as a foundation migration.

The backend now has typed config modules for mail, PDF, and storage; integration ownership for mail/PDF/storage mechanics; a business-neutral database health helper; and auth middleware moved out of Core into the auth module.

## Starting Validation (BE-04)

- Branch: `feat/code-migration`
- Starting commit: `85d0071159be33d06e36a58b1445bbf5d44b3fc3`
- Lint: passed
- Typecheck: passed
- Tests: passed, 23 files / 147 tests
- Build: passed

## Final Validation (BE-04)

- Lint: passed
- Typecheck: passed
- Tests: passed, 24 files / 149 tests
- Focused Companies: `companies.repository.test.ts` (9), `companies.validation.test.ts` (2), `company-code.test.ts` (2)
- Build: passed

## Companies Structure (After BE-04)

`src/modules/companies/`

- `index.ts` — public router export
- `companies.routes.ts` — HTTP workflow for companies, contacts, addresses, quotation history
- `companies.repository.ts` — company CRUD, search/list, quotation history read model, code reservation in transactions
- `company-contacts.repository.ts` — contact persistence and primary-contact transactions
- `company-addresses.repository.ts` — address persistence and per-type primary transactions
- `companies.schema.ts` — request/query validation
- `companies.serializer.ts` — API response mapping
- `companies.types.ts` — pagination helpers
- `code/company-code.ts` — pure formatting and sequence parsing helpers

Contacts and addresses remain co-located at module root (no separate sub-routers) because route volume did not justify capability folders.

## Company Code Decision

- Pure formatting and sequence parsing live in `code/company-code.ts`.
- Database lookup and next-code reservation live in `companies.repository.ts` inside the create transaction.
- Retry-on-unique-conflict behaviour is unchanged (max 5 attempts).

## Quotation History Decision

- Company quotation history remains a Companies-owned read endpoint.
- `companies.repository.ts` queries quotation Prisma models directly (no Quotations repository import).

## Controllers/Services Removed (BE-04)

- `companies.controller.ts`
- `companies.service.ts`
- `company-contacts.service.ts`
- `company-addresses.service.ts`
- `company-code.service.ts`
- `companies.validation.ts` (replaced by `companies.schema.ts`)
- `.gitkeep`

## API Compatibility

All `/api/v1/companies` routes, contracts, messages, and status codes preserved.

## Deferred Work

- Move remaining `AppError` throws from Companies repositories into routes where practical (Categories/Measurement Units pattern).
- Narrow cross-module company read helpers when Quotations migrates (BE-07).

## Current Architecture Summary

Auth, categories, dashboard, measurement units, and companies use route + repository shape. Items, business settings, quotations, quotation documents, quotation email, and quotation attachments still use controller/service layers.

## Target Architecture Summary

Route + repository by default; schemas own validation; integrations own provider mechanics; core stays business-neutral.

## Main Risks

- Quotations remains the largest coupled domain.
- Items and business settings still mix workflow, storage, and Prisma in services.
- Some external-infrastructure behaviour remains embedded in unmigrated feature services.

## Readiness Result

READY WITH CONDITIONS

Conditions: preserve API contracts; migrate remaining domains in planned phases.

## Next Phase

BE-05 — Catalog and Items Domain
