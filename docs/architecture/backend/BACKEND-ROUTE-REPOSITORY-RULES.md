# Route and Repository Rules

## Route Rules

Routes may contain:

- HTTP wiring
- auth middleware
- validation middleware
- validated input extraction
- workflow orchestration
- business conflict checks
- state-transition decisions
- repository calls
- integration calls
- audit calls
- response creation

Routes must not contain:

- raw Prisma calls
- raw SQL
- Nodemailer setup
- Puppeteer setup
- generic filesystem implementation
- environment parsing
- provider initialization

## Repository Rules

Repositories own:

- Prisma and database operations
- transactions
- selections, includes, aggregates, and bulk writes
- typed persistence outputs

Repositories must not:

- depend on Express
- create HTTP responses
- read request objects
- parse environment variables
- initialize integrations

## Practical Guidance

- Large modules should split by business capability rather than forcing controllers, use cases, or port abstractions.
- A repository may expose one meaningful transactional method if the workflow genuinely needs it.
- Avoid one-method repositories that only rename a single Prisma call unless consistency justifies them.

## Completed Examples

- Auth routes own login, refresh, logout, me, and change-password workflow while `auth.repository.ts` owns the user/session writes.
- Categories routes own duplicate-name checks, restore conflict checks, and response shaping while `categories.repository.ts` owns list queries, item-count checks, and audit-coupled persistence.
- Measurement units routes own duplicate-name/symbol checks, restore conflict checks, and response shaping while `measurement-units.repository.ts` owns list queries, item-count checks, and audit-coupled persistence.
- Dashboard routes own query parsing and response creation while `dashboard.repository.ts` owns the aggregate query and result shaping.
