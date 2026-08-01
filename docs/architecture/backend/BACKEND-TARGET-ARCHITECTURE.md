# Target Backend Architecture

## Agreed Decisions

1. Use route + repository as the default module structure.
2. Routes may contain business workflow.
3. Repositories own all Prisma/database operations.
4. Schemas own HTTP input validation.
5. Integrations own external provider mechanics.
6. Config owns environment parsing.
7. Core remains business-neutral.
8. Controllers, services, and use cases are optional.
9. Do not create mandatory interfaces or ports.
10. Do not create a large dependency container.
11. Split large modules by business capability.
12. Preserve every public API contract during migration.
13. Prisma schema remains unchanged unless separately approved.
14. Frontend repository remains untouched by backend phases.
15. Rejected top-level placeholder layers such as `src/controllers`, `src/services`, `src/templates`, and `src/validators` are removed once their completed-phase leftovers are cleaned up.

## Proposed Top-Level Structure

backend/src/

- bootstrap/
- config/
- core/
- integrations/
- modules/

Potential infrastructure split:

- bootstrap: create app, register middleware, register routes, register error handlers, start server
- config: env parsing, database config, mail config, pdf config, storage config
- core: auth, database, errors, HTTP helpers, validation, logging, audit
- integrations: mail, pdf, storage
- modules: all business terminology, workflows, statuses, ownership rules, templates, and feature-specific policies

## Route Model

Routes own:

- HTTP wiring
- validated request extraction
- authenticated user context
- business workflow and orchestration
- conflict checks
- status-code decisions
- repository calls
- integration calls
- audit calls
- response creation

Routes must not own:

- raw Prisma or SQL
- provider setup for mail/PDF/storage
- environment parsing

## Repository Model

Repositories own:

- Prisma calls
- transactions
- filters
- includes and selections
- aggregates
- bulk writes
- typed database results

Repositories must not:

- depend on Express
- read request objects
- create HTTP responses
- parse environment variables
- initialize integrations

## Integration Model

Integrations own:

- mail provider mechanics
- PDF provider mechanics
- safe filesystem mechanics
- provider result normalization
- provider errors

Integrations must not own:

- business status transitions
- revision rules
- ownership rules
- business templates
- database history

## Core Model

Core owns business-neutral infrastructure only:

- authentication middleware contracts
- database client ownership
- generic HTTP response helpers
- generic async handler/error handling
- logging and audit helpers

Core must not import feature modules.

## Module Model

Modules own:

- business terminology
- business rules
- workflow decisions
- statuses
- ownership rules
- feature-specific file policies
- templates

Controllers and services are not mandatory. A module can be a route, repository, and schema set if that is enough.

## Implemented Module Example — Companies (BE-04)

`src/modules/companies/`

- `companies.routes.ts` — all company, contact, address, and quotation-history HTTP endpoints
- `companies.repository.ts` — company persistence, quotation-history read queries, nested create, soft delete/restore
- `company-contacts.repository.ts` — contact CRUD and primary-contact rules
- `company-addresses.repository.ts` — address CRUD and per-type primary rules
- `companies.schema.ts` — Zod validation for company/contact/address inputs and list/history queries
- `code/company-code.ts` — `COMP-` prefix, six-digit padding, sequence parsing
- `index.ts` — exports `companiesRouter` only

## Implemented Module Example — Items (BE-05)

No Catalog parent module was created. Categories remain at `src/modules/categories/`, measurement units at `src/modules/measurement-units/`, and items at `src/modules/items/`.

`src/modules/items/`

- `items.routes.ts` — all item CRUD, options, status, restore, and image upload/delete HTTP endpoints
- `items.repository.ts` — item persistence, category/unit validation queries, code generation with retry, image metadata, quotation usage counts, audit
- `items.schema.ts` — Zod validation for item inputs and list/options queries
- `items.serializer.ts` — API response mapping including `/storage/{path}` image URLs
- `items.types.ts` — pagination and relation types
- `item-specifications.ts` — specification validation and parsing
- `code/item-code.ts` — `ITEM-` prefix, six-digit padding, sequence parsing
- `images/item-image.policy.ts` — Multer wiring, MIME/size/extension policy, relative path mapping; uses storage integration for directory ensure and file delete
- `images/index.ts` — narrow image policy exports
- `index.ts` — exports `itemsRouter` only

## Implemented Module Example — Settings (BE-06/BE-08)

`src/modules/settings/`

- `settings.routes.ts` — business profile, branding, quotation settings, and bank details HTTP endpoints
- `business-profile/business-profile.repository.ts` — singleton profile persistence
- `quotation-settings/quotation-settings.repository.ts` — quotation settings persistence and narrow read helper
- `bank-details/bank-details.repository.ts` — bank CRUD/default persistence
- `branding/branding.repository.ts` — branding metadata persistence and compensation
- `branding/branding.policy.ts` — branding upload policy and storage path mapping
- `settings.quotation-reads.ts` — narrow raw-record reads for quotation PDF/email consumers
- `index.ts` — router plus narrow Settings read/policy/default exports

## Implemented Module Example — Quotations (BE-07/BE-08)

`src/modules/quotations/`

- `quotations.routes.ts` — quotation CRUD, calculation preview, status, and revision endpoints
- `quotations.repository.ts` — quotation persistence, transactions, audit, snapshots, revisions, listing, and status updates
- `calculations/quotation-calculations.ts` — quotation calculation rules
- `numbering/quotation-number.ts` — quotation number formatting and reservation
- `attachments/*` — attachment policy, routes, repository, and types
- `documents/*` — PDF document routes, repository, template, and types
- `communications/quotation-communications.repository.ts` — communication history and quotation email workflow persistence
- `email/*` — email validation and business template
- `index.ts` — exports `quotationsRouter` only

## BE-08 Enforcement

- `tests/architecture/dependency-boundaries.test.ts` enforces stable import boundaries with existing Vitest tooling.
- Rejected placeholder folders are absent from source.
- Runtime storage folders remain physically unchanged.
