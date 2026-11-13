-- Additive reporting metadata and source query indexes. No financial backfill or plan grants.
CREATE TABLE `saved_report_views` (
  `id` VARCHAR(36) NOT NULL,
  `firm_id` INTEGER NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `filter_version` INTEGER NOT NULL DEFAULT 1,
  `filters` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `saved_report_views_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `saved_report_views_firm_id_actor_id_name_key` (`firm_id`, `actor_id`, `name`),
  INDEX `saved_report_views_firm_id_actor_id_updated_at_id_idx` (`firm_id`, `actor_id`, `updated_at`, `id`),
  CONSTRAINT `saved_report_views_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `saved_report_views_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `saved_report_views_version_check` CHECK (`version` > 0 AND `filter_version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `opportunities_reporting_period_idx` ON `opportunities` (`firm_id`, `created_at`, `id`);
CREATE INDEX `opportunities_reporting_owner_idx` ON `opportunities` (`firm_id`, `owner_id`, `created_at`, `id`);
CREATE INDEX `opportunities_reporting_creator_idx` ON `opportunities` (`firm_id`, `created_by_id`, `created_at`, `id`);
CREATE INDEX `stock_movement_reporting_period_idx` ON `stock_movements` (`firm_id`, `posted_at`, `position_id`);
CREATE INDEX `purchase_order_reporting_period_idx` ON `purchase_orders` (`firm_id`, `created_at`, `id`);
CREATE INDEX `supplier_bill_reporting_period_idx` ON `supplier_bills` (`firm_id`, `bill_date`, `id`);
