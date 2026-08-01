# Testing Strategy

## Current Test Structure

- Test framework: Vitest
- Test location: `tests/`
- Coverage style: route/repository tests for migrated BE-03 modules, plus unit-style tests for remaining service-heavy domains and small route/integration-style checks for health and auth middleware
- Prisma mocking: common in service tests
- Mail/PDF/storage mocking: present in quotation email and PDF-related tests

## Current Coverage Shape

- Auth: middleware, route, validation, cookie helpers
- Core health and env: health, env
- Catalog-style domains: categories, measurement units, items, companies
- Settings: business settings service and validation
- Quotation workflow: quotations service, attachments, documents, email
- Seed: initial data behavior

## Future Strategy

- Add route behavior tests where route orchestration matters.
- Add repository tests where database behavior is genuinely complex or transactional.
- Keep integration-provider tests focused on mail, PDF, and storage boundaries with mocks or fakes.
- Preserve regression tests for public API contracts.
- Avoid testing trivial pass-through code unless it guards a real boundary.
