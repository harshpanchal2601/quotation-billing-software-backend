-- Optional extension only. No feature grants, financial backfill or quantity store.
CREATE TABLE `bills_of_materials` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `revision` INTEGER NOT NULL,
  `output_item_id` INTEGER NOT NULL,
  `output_quantity` DECIMAL(18,3) NOT NULL,
  `output_unit_id` INTEGER NOT NULL,
  `output_name` VARCHAR(191) NOT NULL,
  `output_unit` VARCHAR(50) NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `bills_of_materials_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `bills_of_materials_firm_id_code_revision_key` (`firm_id`, `code`, `revision`),
  UNIQUE INDEX `bills_of_materials_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `bills_of_materials_output_item_id_firm_id_idx` (`output_item_id`, `firm_id`),
  CONSTRAINT `bills_of_materials_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `bills_of_materials_output_owner_fkey` FOREIGN KEY (`output_item_id`, `firm_id`) REFERENCES `items` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `bills_of_materials_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `bills_of_materials_positive_check` CHECK (`output_quantity` > 0 AND `output_quantity` < 1000000000 AND `revision` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bom_components` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `bom_id` INTEGER NOT NULL,
  `item_id` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `unit_id` INTEGER NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `unit` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `bom_components_bom_id_item_id_key` (`bom_id`, `item_id`),
  INDEX `bom_components_bom_id_firm_id_idx` (`bom_id`, `firm_id`),
  INDEX `bom_components_item_id_firm_id_idx` (`item_id`, `firm_id`),
  CONSTRAINT `bom_components_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `bom_components_bom_owner_fkey` FOREIGN KEY (`bom_id`, `firm_id`) REFERENCES `bills_of_materials` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `bom_components_item_owner_fkey` FOREIGN KEY (`item_id`, `firm_id`) REFERENCES `items` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `bom_components_positive_check` CHECK (`quantity` > 0 AND `quantity` < 1000000000)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `work_orders` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `firm_id` INTEGER NOT NULL,
  `bom_id` INTEGER NOT NULL,
  `warehouse_id` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `version` INTEGER NOT NULL DEFAULT 1,
  `snapshot` JSON NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `completion_key` VARCHAR(100) NULL,
  `completion_hash` CHAR(64) NULL,
  `cancellation_key` VARCHAR(100) NULL,
  `cancellation_hash` CHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `work_orders_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `work_orders_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  UNIQUE INDEX `work_orders_firm_id_completion_key_key` (`firm_id`, `completion_key`),
  UNIQUE INDEX `work_orders_firm_id_cancellation_key_key` (`firm_id`, `cancellation_key`),
  INDEX `work_orders_bom_id_firm_id_idx` (`bom_id`, `firm_id`),
  INDEX `work_orders_warehouse_id_firm_id_idx` (`warehouse_id`, `firm_id`),
  INDEX `work_orders_firm_id_status_id_idx` (`firm_id`, `status`, `id`),
  CONSTRAINT `work_orders_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `work_orders_bom_owner_fkey` FOREIGN KEY (`bom_id`, `firm_id`) REFERENCES `bills_of_materials` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `work_orders_warehouse_owner_fkey` FOREIGN KEY (`warehouse_id`, `firm_id`) REFERENCES `warehouses` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `work_orders_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `work_orders_positive_check` CHECK (`quantity` > 0 AND `quantity` < 1000000000 AND `version` > 0),
  CONSTRAINT `work_orders_status_check` CHECK (`status` IN ('DRAFT', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT `work_orders_command_state_check` CHECK (
    (`status` = 'DRAFT' AND `completion_key` IS NULL AND `completion_hash` IS NULL AND `cancellation_key` IS NULL AND `cancellation_hash` IS NULL)
    OR (`status` = 'COMPLETED' AND `completion_key` IS NOT NULL AND `completion_hash` IS NOT NULL AND `cancellation_key` IS NULL AND `cancellation_hash` IS NULL)
    OR (`status` = 'CANCELLED' AND `cancellation_key` IS NOT NULL AND `cancellation_hash` IS NOT NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `stock_movements` ADD COLUMN `work_order_id` INTEGER NULL;
CREATE INDEX `stock_movements_work_order_id_firm_id_idx` ON `stock_movements` (`work_order_id`, `firm_id`);
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_work_order_owner_fkey`
  FOREIGN KEY (`work_order_id`, `firm_id`) REFERENCES `work_orders` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_work_order_source_check`
  CHECK (`work_order_id` IS NULL OR (`source_type` = 'WORK_ORDER' AND `source_id` = `work_order_id`));
