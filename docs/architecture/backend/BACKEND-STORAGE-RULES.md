# Storage Rules

## Qorwell storage contract

The shared integration in `src/integrations/storage` selects local disk or private
S3 using `STORAGE_DRIVER`. Modules own authorization, naming, file validation and
retention decisions; the integration owns provider I/O and bounded upload spooling.
All managed consumers use the same provider. S3 failures never fall back to disk.

New paths contain a numeric firm ID and a safe name snapshot, for example
`quotation-documents/5-qa-end-to-end-20261113/<uuid>.pdf` and
`firm-assets/5-qa-end-to-end-20261113/logos/logo-<uuid>.png`. The shared helpers in
`src/config/storage.config.ts` generate and validate these paths. Background report
exports and billing PDFs read the firm's name from their authorized database flow.
Uploads persist their actual saved path rather than rebuilding it after upload.

The database path stays authoritative after a firm rename. Historical numeric
folders remain readable, and the name never replaces tenant authorization. Public
display assets retain backend `/storage/...` URLs; PDFs, attachments and exports
retain their authorized API routes. S3 objects are not public.

Provider switching requires a verified copy and a coordinated restart. It does not
move existing files automatically or rewrite database paths. See
[the Qorwell storage runbook](../../implementation/qorwell-storage-integration.txt)
for the deployed AWS infrastructure, environment settings, copy/recovery commands,
cost assumptions, verification and live-application deployment limits.

The BE-05/BE-08 notes below are historical records of the earlier local migration.

## Earlier Local Runtime Storage

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

## Items Image Storage (BE-05)

- Directory: `storage/items` (unchanged)
- Public URL prefix: `/storage/items/...` (unchanged)
- No physical file migration performed
- Items adopted storage integration for directory ensure and file delete
- Remaining direct filesystem consumers: business-settings branding, quotation attachments, quotation documents

## BE-08 Storage Inventory

- Item images: owner `items`; physical `storage/items`; database path `items/{filename}`; public URL `/storage/items/{filename}`; delete policy on replacement/delete/compensation.
- Branding logo/signature/stamp: owner `settings`; physical `storage/logos`, `storage/signatures`, `storage/stamps`; database paths `{directory}/{filename}`; public URL `/storage/{path}`.
- Quotation PDFs: owner `quotations/documents`; physical `storage/quotation-documents`; database path `quotation-documents/{uuid}.pdf`; protected preview/download endpoints under `/api/v1/quotations/:id/pdf/:documentId/*`.
- Quotation attachments: owner `quotations/attachments`; physical `storage/quotation-attachments`; database path `quotation-attachments/{uuid}.{ext}`; protected preview/download endpoints under `/api/v1/quotations/:quotationId/attachments/:attachmentId/*`.
- Runtime placeholders retained: `storage/attachments/.gitkeep`, `storage/items/.gitkeep`, `storage/logos/.gitkeep`, `storage/quotations/.gitkeep`, `storage/signatures/.gitkeep`, `storage/stamps/.gitkeep`.
- Physical storage files were not moved, renamed, rewritten, or deleted in BE-08.
- Public asset directories remain `items`, `logos`, `signatures`, and `stamps`; quotation documents and attachments remain protected.
