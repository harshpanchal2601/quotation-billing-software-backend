-- Wave 07 additive inventory and bounded supplier purchasing. Source SQL only.
-- Existing catalog entries remain untracked. Classify service entries explicitly.
ALTER TABLE `items` ADD COLUMN `kind` ENUM('GOODS', 'SERVICE') NOT NULL DEFAULT 'GOODS', ADD COLUMN `stock_tracking` BOOLEAN NOT NULL DEFAULT false, ADD CONSTRAINT `items_stock_kind_check` CHECK (`stock_tracking` = false OR `kind` = 'GOODS');
ALTER TABLE `companies` ADD COLUMN `is_supplier` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `warehouses` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `warehouses_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `warehouses_firm_id_code_key` (`firm_id`, `code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_positions` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `warehouse_id` INTEGER NOT NULL,
  `item_id` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `on_hand` DECIMAL(18,3) NOT NULL DEFAULT 0,
  `reserved` DECIMAL(18,3) NOT NULL DEFAULT 0,
  `value` DECIMAL(30,6) NOT NULL DEFAULT 0,
  `reorder_level` DECIMAL(18,3) NOT NULL DEFAULT 0,
  UNIQUE INDEX `stock_positions_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `stock_positions_firm_id_warehouse_id_item_id_key` (`firm_id`, `warehouse_id`, `item_id`),
  INDEX `stock_positions_item_id_firm_id_idx` (`item_id`, `firm_id`),
  INDEX `stock_positions_warehouse_id_firm_id_idx` (`warehouse_id`, `firm_id`),
  CONSTRAINT `stock_positions_check_1` CHECK (`on_hand` >= 0 AND `reserved` >= 0 AND `reserved` <= `on_hand`),
  CONSTRAINT `stock_positions_check_2` CHECK (`value` >= 0 AND (`on_hand` > 0 OR `value` = 0)),
  CONSTRAINT `stock_positions_check_3` CHECK (`reorder_level` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_movements` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `position_id` INTEGER NOT NULL,
  `source_type` VARCHAR(30) NOT NULL,
  `source_id` INTEGER NOT NULL,
  `source_line_id` INTEGER NOT NULL,
  `event_type` VARCHAR(30) NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `value` DECIMAL(30,6) NOT NULL,
  `original_movement_id` INTEGER NULL,
  `reason` VARCHAR(2000) NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `posted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `stock_movements_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `stock_movement_source_event_key` (`firm_id`, `source_type`, `source_id`, `source_line_id`, `event_type`),
  INDEX `stock_movement_position_period_idx` (`position_id`, `firm_id`, `posted_at`, `id`),
  INDEX `stock_movements_original_movement_id_firm_id_idx` (`original_movement_id`, `firm_id`),
  CONSTRAINT `stock_movements_check_1` CHECK (`quantity` <> 0),
  CONSTRAINT `stock_movements_check_2` CHECK ((`quantity` > 0 AND `value` >= 0) OR (`quantity` < 0 AND `value` <= 0))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_reservations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `position_id` INTEGER NOT NULL,
  `sales_order_id` INTEGER NOT NULL,
  `sales_order_line_id` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `remaining` DECIMAL(18,3) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `release_reason` VARCHAR(2000) NULL,
  UNIQUE INDEX `stock_reservations_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `stock_reservations_position_id_firm_id_status_idx` (`position_id`, `firm_id`, `status`),
  INDEX `stock_reservation_order_idx` (`firm_id`, `sales_order_id`, `sales_order_line_id`, `status`),
  CONSTRAINT `stock_reservations_check_1` CHECK (`quantity` > 0 AND `remaining` >= 0 AND `remaining` <= `quantity`),
  CONSTRAINT `stock_reservations_check_2` CHECK ((`status` = 'ACTIVE' AND `remaining` > 0) OR (`status` IN ('CONSUMED','RELEASED') AND `remaining` = 0))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_operations` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `kind` VARCHAR(30) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `stock_operations_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `stock_operations_firm_id_kind_id_idx` (`firm_id`, `kind`, `id`),
  CONSTRAINT `stock_operations_check_1` CHECK (`kind` IN ('ADJUSTMENT','TRANSFER','RETURN'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_orders` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `supplier_id` INTEGER NOT NULL,
  `order_number` VARCHAR(50) NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  `version` INTEGER NOT NULL DEFAULT 1,
  `expected_date` DATE NULL,
  `currency` VARCHAR(3) NOT NULL,
  `supplier_snapshot` JSON NOT NULL,
  `financial_snapshot` JSON NOT NULL,
  `total` DECIMAL(24,3) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `cancellation_reason` VARCHAR(2000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `purchase_orders_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `purchase_orders_firm_id_order_number_key` (`firm_id`, `order_number`),
  UNIQUE INDEX `purchase_orders_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `purchase_orders_supplier_id_firm_id_idx` (`supplier_id`, `firm_id`),
  INDEX `purchase_orders_firm_id_status_id_idx` (`firm_id`, `status`, `id`),
  CONSTRAINT `purchase_orders_check_1` CHECK (`status` IN ('DRAFT','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  CONSTRAINT `purchase_orders_check_2` CHECK (`total` >= 0 AND `version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_order_lines` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `purchase_order_id` INTEGER NOT NULL,
  `item_id` INTEGER NOT NULL,
  `line_number` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `received_quantity` DECIMAL(18,3) NOT NULL DEFAULT 0,
  `unit_cost` DECIMAL(24,3) NOT NULL,
  `snapshot` JSON NOT NULL,
  UNIQUE INDEX `purchase_order_lines_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `purchase_order_lines_purchase_order_id_line_number_key` (`purchase_order_id`, `line_number`),
  INDEX `purchase_order_lines_item_id_firm_id_idx` (`item_id`, `firm_id`),
  CONSTRAINT `purchase_order_lines_check_1` CHECK (`quantity` > 0 AND `received_quantity` >= 0 AND `received_quantity` <= `quantity` AND `unit_cost` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `goods_receipts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `purchase_order_id` INTEGER NOT NULL,
  `warehouse_id` INTEGER NULL,
  `reference` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `cancelled_at` DATETIME(3) NULL,
  `cancellation_reason` VARCHAR(2000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `goods_receipts_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `goods_receipts_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `goods_receipts_purchase_order_id_firm_id_idx` (`purchase_order_id`, `firm_id`),
  INDEX `goods_receipts_warehouse_id_firm_id_idx` (`warehouse_id`, `firm_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `goods_receipt_lines` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `goods_receipt_id` INTEGER NOT NULL,
  `purchase_order_line_id` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `returned_quantity` DECIMAL(18,3) NOT NULL DEFAULT 0,
  UNIQUE INDEX `goods_receipt_lines_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `goods_receipt_lines_goods_receipt_id_purchase_order_line_id_key` (`goods_receipt_id`, `purchase_order_line_id`),
  INDEX `goods_receipt_lines_purchase_order_line_id_firm_id_idx` (`purchase_order_line_id`, `firm_id`),
  CONSTRAINT `goods_receipt_lines_check_1` CHECK (`quantity` > 0 AND `returned_quantity` >= 0 AND `returned_quantity` <= `quantity`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `goods_receipt_returns` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `receipt_line_id` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `reason` VARCHAR(2000) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `goods_receipt_returns_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `goods_receipt_returns_receipt_line_id_firm_id_idx` (`receipt_line_id`, `firm_id`),
  INDEX `goods_receipt_returns_firm_id_id_idx` (`firm_id`, `id`),
  CONSTRAINT `goods_receipt_returns_check_1` CHECK (`quantity` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `supplier_bills` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `supplier_id` INTEGER NOT NULL,
  `supplier_reference` VARCHAR(100) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `version` INTEGER NOT NULL DEFAULT 1,
  `bill_date` DATE NOT NULL,
  `due_date` DATE NULL,
  `currency` VARCHAR(3) NOT NULL,
  `supplier_snapshot` JSON NOT NULL,
  `financial_snapshot` JSON NOT NULL,
  `total` DECIMAL(24,3) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `void_reason` VARCHAR(2000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `supplier_bills_id_firm_id_key` (`id`, `firm_id`),
  UNIQUE INDEX `supplier_bills_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  UNIQUE INDEX `supplier_bill_reference_key` (`firm_id`, `supplier_id`, `supplier_reference`),
  INDEX `supplier_bills_supplier_id_firm_id_idx` (`supplier_id`, `firm_id`),
  INDEX `supplier_bills_firm_id_status_id_idx` (`firm_id`, `status`, `id`),
  CONSTRAINT `supplier_bills_check_1` CHECK (`status` IN ('DRAFT','POSTED','VOID') AND `total` >= 0 AND `version` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `supplier_bill_lines` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `supplier_bill_id` INTEGER NOT NULL,
  `purchase_order_line_id` INTEGER NULL,
  `goods_receipt_line_id` INTEGER NULL,
  `line_number` INTEGER NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL,
  `snapshot` JSON NOT NULL,
  UNIQUE INDEX `supplier_bill_lines_supplier_bill_id_line_number_key` (`supplier_bill_id`, `line_number`),
  INDEX `supplier_bill_lines_purchase_order_line_id_firm_id_idx` (`purchase_order_line_id`, `firm_id`),
  INDEX `supplier_bill_lines_goods_receipt_line_id_firm_id_idx` (`goods_receipt_line_id`, `firm_id`),
  CONSTRAINT `supplier_bill_lines_check_1` CHECK (`quantity` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `expenses` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`id`),
  `firm_id` INTEGER NOT NULL,
  `supplier_id` INTEGER NULL,
  `category` VARCHAR(100) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `expense_date` DATE NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `total` DECIMAL(24,3) NOT NULL,
  `snapshot` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'POSTED',
  `void_reason` VARCHAR(2000) NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `actor_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `expenses_firm_id_idempotency_key_key` (`firm_id`, `idempotency_key`),
  INDEX `expenses_supplier_id_firm_id_idx` (`supplier_id`, `firm_id`),
  INDEX `expenses_firm_id_expense_date_id_idx` (`firm_id`, `expense_date`, `id`),
  CONSTRAINT `expenses_check_1` CHECK (`status` IN ('POSTED','VOID') AND `total` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `stock_positions` ADD CONSTRAINT `stock_positions_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `stock_positions` ADD CONSTRAINT `stock_positions_warehouse_id_firm_id_fkey` FOREIGN KEY (`warehouse_id`, `firm_id`) REFERENCES `warehouses` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_positions` ADD CONSTRAINT `stock_positions_item_id_firm_id_fkey` FOREIGN KEY (`item_id`, `firm_id`) REFERENCES `items` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_position_id_firm_id_fkey` FOREIGN KEY (`position_id`, `firm_id`) REFERENCES `stock_positions` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_original_movement_id_firm_id_fkey` FOREIGN KEY (`original_movement_id`, `firm_id`) REFERENCES `stock_movements` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservations_position_id_firm_id_fkey` FOREIGN KEY (`position_id`, `firm_id`) REFERENCES `stock_positions` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_reservations` ADD CONSTRAINT `stock_reservation_order_line_fkey` FOREIGN KEY (`sales_order_line_id`, `firm_id`, `sales_order_id`) REFERENCES `sales_order_lines` (`id`, `firm_id`, `sales_order_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_operations` ADD CONSTRAINT `stock_operations_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stock_operations` ADD CONSTRAINT `stock_operations_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplier_id_firm_id_fkey` FOREIGN KEY (`supplier_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_purchase_order_id_firm_id_fkey` FOREIGN KEY (`purchase_order_id`, `firm_id`) REFERENCES `purchase_orders` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_item_id_firm_id_fkey` FOREIGN KEY (`item_id`, `firm_id`) REFERENCES `items` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_purchase_order_id_firm_id_fkey` FOREIGN KEY (`purchase_order_id`, `firm_id`) REFERENCES `purchase_orders` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_warehouse_id_firm_id_fkey` FOREIGN KEY (`warehouse_id`, `firm_id`) REFERENCES `warehouses` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `goods_receipt_lines_goods_receipt_id_firm_id_fkey` FOREIGN KEY (`goods_receipt_id`, `firm_id`) REFERENCES `goods_receipts` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `goods_receipt_lines_purchase_order_line_id_firm_id_fkey` FOREIGN KEY (`purchase_order_line_id`, `firm_id`) REFERENCES `purchase_order_lines` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `goods_receipt_returns` ADD CONSTRAINT `goods_receipt_returns_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `goods_receipt_returns` ADD CONSTRAINT `goods_receipt_returns_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `goods_receipt_returns` ADD CONSTRAINT `goods_receipt_returns_receipt_line_id_firm_id_fkey` FOREIGN KEY (`receipt_line_id`, `firm_id`) REFERENCES `goods_receipt_lines` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `supplier_bills` ADD CONSTRAINT `supplier_bills_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `supplier_bills` ADD CONSTRAINT `supplier_bills_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `supplier_bills` ADD CONSTRAINT `supplier_bills_supplier_id_firm_id_fkey` FOREIGN KEY (`supplier_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `supplier_bill_lines` ADD CONSTRAINT `supplier_bill_lines_supplier_bill_id_firm_id_fkey` FOREIGN KEY (`supplier_bill_id`, `firm_id`) REFERENCES `supplier_bills` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `supplier_bill_lines` ADD CONSTRAINT `supplier_bill_lines_purchase_order_line_id_firm_id_fkey` FOREIGN KEY (`purchase_order_line_id`, `firm_id`) REFERENCES `purchase_order_lines` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `supplier_bill_lines` ADD CONSTRAINT `supplier_bill_lines_goods_receipt_line_id_firm_id_fkey` FOREIGN KEY (`goods_receipt_line_id`, `firm_id`) REFERENCES `goods_receipt_lines` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_firm_id_fkey` FOREIGN KEY (`firm_id`) REFERENCES `firms` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_supplier_id_firm_id_fkey` FOREIGN KEY (`supplier_id`, `firm_id`) REFERENCES `companies` (`id`, `firm_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
