-- Export configuration only. No general ledger, financial rewrite or defaults.
CREATE TABLE `accounting_mapping_versions` (
  `firm_id` INTEGER NOT NULL, `version` INTEGER NOT NULL, `mapping` JSON NOT NULL,
  `actor_id` INTEGER NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`firm_id`, `version`),
  CONSTRAINT `accounting_mapping_versions_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `accounting_mapping_versions_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (`version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
