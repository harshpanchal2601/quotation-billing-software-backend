-- Nullable metadata preserves legacy batches; only explicitly classified new
-- batches are writable by the controlled CSV workflow. No business backfill.
ALTER TABLE `import_batches`
  ADD COLUMN `target` VARCHAR(20) NULL,
  ADD COLUMN `content_hash` CHAR(64) NULL,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1,
  ADD UNIQUE INDEX `import_batches_firm_actor_target_hash_key` (`firm_id`, `started_by_id`, `target`, `content_hash`),
  ADD INDEX `import_batches_firm_target_started_idx` (`firm_id`, `target`, `started_at`);
ALTER TABLE `import_rows`
  ADD COLUMN `target_id` INTEGER NULL,
  ADD COLUMN `imported_at` DATETIME(3) NULL,
  ADD COLUMN `target_updated_at` DATETIME(3) NULL,
  ADD COLUMN `target_fingerprint` CHAR(64) NULL,
  ADD COLUMN `compensated_at` DATETIME(3) NULL,
  ADD INDEX `import_rows_source_status_batch_idx` (`source_identifier`, `status`, `import_batch_id`);
