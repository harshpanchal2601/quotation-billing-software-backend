# Storage Rules

## Current Runtime Storage

- Root: `storage/`
- Public assets: `storage/items`, `storage/logos`, `storage/signatures`, `storage/stamps`
- Attachments: `storage/quotation-attachments`
- Generated PDFs: `storage/quotation-documents`
- Other runtime folders: `storage/attachments`, `storage/quotations`, `storage/items`

## Current Safety Characteristics

- Path traversal checks exist in branding, attachment, and PDF helpers.
- Public static serving is limited to known asset directories.
- Runtime files are not part of the source tree, but sample artifacts are currently committed under storage.

## Target Storage Direction

- Storage integration should own safe filesystem mechanics only.
- Modules should own file-type policy, file-size policy, ownership policy, naming policy, and delete permission decisions.
- Physical storage migration should remain a separate future operation with backup and rollback planning.
