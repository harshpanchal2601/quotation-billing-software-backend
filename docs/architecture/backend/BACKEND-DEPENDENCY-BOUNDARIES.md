# Dependency Boundaries

## Allowed Direction

- bootstrap → modules → core → config
- modules may also import integrations
- repositories may import core database helpers and narrowly scoped module-local helpers
- integrations may import config and core errors/logging

## Current Violations Found

- `src/modules/auth/auth.middleware.ts` owns authentication middleware and token verification boundary usage; Core no longer imports auth-module internals for this flow.

## Boundary Notes

- Config must not import modules.
- Core must not import feature modules.
- Modules should not import another module’s internal repository directly unless it is an intentional public boundary.
- Shared functionality should stay business-neutral in core; feature wording and workflow should stay in modules.
