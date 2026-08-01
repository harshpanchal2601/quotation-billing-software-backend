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
