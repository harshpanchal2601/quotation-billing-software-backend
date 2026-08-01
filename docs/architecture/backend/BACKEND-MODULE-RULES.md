# Module Rules

## Module Responsibilities

Modules own:

- business terminology
- business rules
- workflow decisions
- statuses
- ownership rules
- feature-specific file policies
- templates

## Module Design Preferences

- Prefer route + repository + schema as the default shape.
- Split large areas by capability when the domain gets broad.
- Avoid mandatory controllers, services, or use cases when a simpler shape is enough.
- Keep module public boundaries narrow and explicit.

## Current Module Observations

- Auth, categories, dashboard, and measurement units already have explicit public index files.
- Companies, items, business settings, quotations, quotation email, quotation documents, and quotation attachments still rely on direct file imports.
- Quotation is the only domain that is clearly complex enough to justify a dedicated capability tree in later phases.
