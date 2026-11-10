-- Aggregate artifacts only; no financial source or legal document changes.
CREATE TABLE `report_export_jobs` (
  `id` VARCHAR(36) NOT NULL, `firm_id` INTEGER NOT NULL, `actor_id` INTEGER NOT NULL,
  `request_key` VARCHAR(100) NOT NULL, `request_hash` CHAR(64) NOT NULL,
  `format` VARCHAR(8) NOT NULL, `filters` JSON NOT NULL,
  `event_id` VARCHAR(36) NOT NULL, `report_snapshot` JSON NULL,
  `file_path` VARCHAR(191) NULL, `file_hash` CHAR(64) NULL, `file_size` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL, `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `report_export_jobs_event_id_firm_id_key` (`event_id`, `firm_id`),
  UNIQUE INDEX `report_export_jobs_firm_id_actor_id_request_key_key` (`firm_id`, `actor_id`, `request_key`),
  INDEX `report_export_jobs_firm_id_actor_id_created_at_idx` (`firm_id`, `actor_id`, `created_at`),
  CONSTRAINT `report_export_jobs_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_export_jobs_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_export_jobs_event_id_firm_id_fkey` FOREIGN KEY (`event_id`, `firm_id`) REFERENCES `outbox_events` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (`format` IN ('csv', 'xlsx', 'pdf')),
  CHECK (`file_size` IS NULL OR `file_size` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
