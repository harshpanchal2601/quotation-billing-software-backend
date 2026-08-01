# Testing Strategy

## Current Test Structure

- Test framework: Vitest
- Test location: `tests/`
- Coverage style: route/repository/schema/policy/template tests, plus architecture-boundary checks and small route/integration-style checks for health and auth middleware
- Prisma mocking: common in repository tests
- Mail/PDF/storage mocking: present in quotation email and PDF-related tests

## Current Coverage Shape

- Auth: middleware, route, validation, cookie helpers
- Core health and env: health, env
- Catalog-style domains: categories and measurement units (routes + repositories); companies (repositories + schema + `code/company-code` helpers); items (repository + schema + `code/item-code` + `images/item-image.policy` helpers)
- Settings: settings repositories and validation
- Quotation workflow: quotation repository, attachment policy, document template, communications repository, and email template/schema behavior
- Seed: initial data behavior

## Future Strategy

- Add route behavior tests where route orchestration matters.
- Add repository tests where database behavior is genuinely complex or transactional.
- Keep integration-provider tests focused on mail, PDF, and storage boundaries with mocks or fakes.
- Preserve regression tests for public API contracts.
- Avoid testing trivial pass-through code unless it guards a real boundary.

## BE-08 Current Test Strategy

- Test framework: Vitest.
- Test count after BE-08 enforcement: `27` files / `162` tests.
- Test organization remains flat except for `tests/architecture/`, which owns dependency-boundary enforcement.
- Legacy `*.service.test.ts` names were renamed to current ownership:
  - `categories.repository.test.ts`
  - `dashboard.repository.test.ts`
  - `measurement-units.repository.test.ts`
  - `quotation-attachments.policy.test.ts`
  - `quotation-communications.repository.test.ts`
  - `quotation-documents.template.test.ts`
  - `quotations.repository.test.ts`
- Repository tests mock Prisma and must not require a live MySQL server.
- Quotation email tests mock the mail integration API and filesystem stats; no real email is sent.
- PDF tests verify template and storage safety markers; they do not launch uncontrolled browsers or generate production PDFs.
- Filesystem tests either mock filesystem APIs or use controlled fixture writes with cleanup.
