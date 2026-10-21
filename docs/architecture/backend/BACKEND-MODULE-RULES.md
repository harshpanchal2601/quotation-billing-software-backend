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

- Auth, categories, dashboard, measurement units, companies, and items have explicit public index files exporting routers only.
- Auth uses route + repository + helpers; categories, dashboard, measurement units, companies, and items use route + repository + schema.
- Companies organisation: core company workflow in `companies.routes.ts` + `companies.repository.ts`; contacts and addresses in dedicated repositories at module root; company code formatting in `code/company-code.ts`; database code sequencing in the companies repository transaction.
- Company quotation history is an intentional Companies-owned read model querying quotation tables directly until BE-07.
- Items organisation: core item workflow in `items.routes.ts` + `items.repository.ts`; item code formatting in `code/item-code.ts`; database code sequencing and retry in `items.repository.ts`; image MIME/size/extension policy and Multer wiring in `images/item-image.policy.ts`; generic filesystem operations via storage integration.
- Category and measurement unit boundaries: Items repository queries `itemCategory` and `measurementUnit` Prisma models directly for existence/active checks (no cross-module repository imports).
- Business settings, quotations, quotation email, quotation documents, and quotation attachments still rely on direct file imports and controller/service layers.

## BE-08 Final Module Rules

- Business modules use route + repository by default.
- Schemas own validation and coercion only.
- Capability folders are allowed inside large domains when they keep ownership clear, as in `src/modules/quotations/{attachments,documents,email,communications}`.
- Public `index.ts` files must stay explicit and narrow.
- Internal module files should use relative imports inside their own module.
- Cross-module imports must use narrow public boundaries unless the module owns a direct Prisma relationship check.
- Controllers and services are not part of the current backend architecture unless a future phase explicitly justifies one.
- Rejected `.gitkeep`-only source folders must not return.
- Quotation is the only domain that is clearly complex enough to justify a dedicated capability tree in later phases.
