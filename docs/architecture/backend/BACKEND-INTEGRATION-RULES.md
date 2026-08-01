# Integration Rules

## Mail

Mail integrations own:

- SMTP and Nodemailer mechanics
- provider setup
- recipient normalization at the provider boundary
- provider error normalization

Mail integrations must not own:

- quotation status transitions
- communication business rules
- template selection tied to business workflows

## PDF

PDF integrations own:

- Puppeteer/browser lifecycle
- generic HTML-to-PDF conversion
- provider cleanup and timeout handling

PDF integrations must not own:

- quotation revision rules
- branding policy
- document history policy

## Storage

Storage integrations own:

- safe filesystem operations
- storage-root handling
- path validation
- read/write/delete/existence operations
- generic storage errors

Storage integrations must not own:

- item-image policy
- branding policy
- attachment ownership
- file naming rules that depend on domain decisions
