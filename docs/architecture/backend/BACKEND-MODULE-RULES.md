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

- Auth, categories, dashboard, measurement units, and companies have explicit public index files exporting routers only.
- Auth uses route + repository + helpers; categories, dashboard, measurement units, and companies use route + repository + schema.
- Companies organisation: core company workflow in `companies.routes.ts` + `companies.repository.ts`; contacts and addresses in dedicated repositories at module root; company code formatting in `code/company-code.ts`; database code sequencing in the companies repository transaction.
- Company quotation history is an intentional Companies-owned read model querying quotation tables directly until BE-07.
- Items, business settings, quotations, quotation email, quotation documents, and quotation attachments still rely on direct file imports and controller/service layers.
- Quotation is the only domain that is clearly complex enough to justify a dedicated capability tree in later phases.
