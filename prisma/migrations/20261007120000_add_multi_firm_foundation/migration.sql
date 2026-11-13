-- Add the multi-firm ownership foundation and backfill the existing installation.

CREATE TABLE `firms` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `user_limit` INTEGER NOT NULL DEFAULT 4,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `firms_slug_key`(`slug`),
    INDEX `firms_status_idx`(`status`),
    INDEX `firms_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `firm_roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `firm_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `permissions` JSON NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `firm_roles_firm_id_name_key`(`firm_id`, `name`),
    INDEX `firm_roles_firm_id_deleted_at_idx`(`firm_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `users`
    ADD COLUMN `firm_id` INTEGER NULL,
    ADD COLUMN `firm_role_id` INTEGER NULL,
    ADD COLUMN `account_type` ENUM('SUPER_ADMIN', 'FIRM_ADMIN', 'FIRM_USER') NOT NULL DEFAULT 'FIRM_ADMIN',
    ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    ADD INDEX `users_firm_id_idx`(`firm_id`),
    ADD INDEX `users_firm_role_id_idx`(`firm_role_id`),
    ADD INDEX `users_account_type_idx`(`account_type`);

ALTER TABLE `business_profiles` ADD COLUMN `firm_id` INTEGER NULL;
ALTER TABLE `companies` ADD COLUMN `firm_id` INTEGER NULL;
ALTER TABLE `item_categories` ADD COLUMN `firm_id` INTEGER NULL;
ALTER TABLE `measurement_units` ADD COLUMN `firm_id` INTEGER NULL;
ALTER TABLE `items` ADD COLUMN `firm_id` INTEGER NULL;
ALTER TABLE `quotations` ADD COLUMN `firm_id` INTEGER NULL;
ALTER TABLE `terms_templates` ADD COLUMN `firm_id` INTEGER NULL;
ALTER TABLE `import_batches` ADD COLUMN `firm_id` INTEGER NULL;
ALTER TABLE `audit_logs` ADD COLUMN `firm_id` INTEGER NULL;

ALTER TABLE `quotation_settings`
    MODIFY `quotation_prefix` VARCHAR(50) NOT NULL DEFAULT 'ERP';

-- Existing production data belongs to the original Buminex firm. On a fresh,
-- empty database this insert is skipped and onboarding creates the first firm.
INSERT INTO `firms` (`name`, `slug`, `status`, `user_limit`, `created_at`, `updated_at`)
SELECT
    COALESCE(
        (SELECT `display_name` FROM `business_profiles` ORDER BY `id` ASC LIMIT 1),
        'Buminex'
    ),
    'buminex',
    'ACTIVE',
    4,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM DUAL
WHERE EXISTS (SELECT 1 FROM `users` LIMIT 1)
   OR EXISTS (SELECT 1 FROM `business_profiles` LIMIT 1);

SET @initial_firm_id = (
    SELECT `id`
    FROM `firms`
    WHERE `slug` = 'buminex'
    LIMIT 1
);

UPDATE `users`
SET `firm_id` = @initial_firm_id,
    `account_type` = 'FIRM_ADMIN'
WHERE `firm_id` IS NULL;

UPDATE `business_profiles` SET `firm_id` = @initial_firm_id WHERE `firm_id` IS NULL;
UPDATE `companies` SET `firm_id` = @initial_firm_id WHERE `firm_id` IS NULL;
UPDATE `item_categories` SET `firm_id` = @initial_firm_id WHERE `firm_id` IS NULL;
UPDATE `measurement_units` SET `firm_id` = @initial_firm_id WHERE `firm_id` IS NULL;
UPDATE `items` SET `firm_id` = @initial_firm_id WHERE `firm_id` IS NULL;
UPDATE `quotations` SET `firm_id` = @initial_firm_id WHERE `firm_id` IS NULL;
UPDATE `terms_templates` SET `firm_id` = @initial_firm_id WHERE `firm_id` IS NULL;
UPDATE `import_batches` SET `firm_id` = @initial_firm_id WHERE `firm_id` IS NULL;
UPDATE `audit_logs` SET `firm_id` = @initial_firm_id WHERE `firm_id` IS NULL;

ALTER TABLE `business_profiles` MODIFY `firm_id` INTEGER NOT NULL;
ALTER TABLE `companies` MODIFY `firm_id` INTEGER NOT NULL;
ALTER TABLE `item_categories` MODIFY `firm_id` INTEGER NOT NULL;
ALTER TABLE `measurement_units` MODIFY `firm_id` INTEGER NOT NULL;
ALTER TABLE `items` MODIFY `firm_id` INTEGER NOT NULL;
ALTER TABLE `quotations` MODIFY `firm_id` INTEGER NOT NULL;
ALTER TABLE `terms_templates` MODIFY `firm_id` INTEGER NOT NULL;
ALTER TABLE `import_batches` MODIFY `firm_id` INTEGER NOT NULL;

ALTER TABLE `business_profiles`
    ADD UNIQUE INDEX `business_profiles_firm_id_key`(`firm_id`);

ALTER TABLE `companies`
    DROP INDEX `companies_company_code_key`,
    DROP INDEX `companies_name_idx`,
    ADD UNIQUE INDEX `companies_firm_id_company_code_key`(`firm_id`, `company_code`),
    ADD INDEX `companies_firm_id_name_idx`(`firm_id`, `name`);

ALTER TABLE `item_categories`
    DROP INDEX `item_categories_name_key`,
    DROP INDEX `item_categories_slug_key`,
    ADD UNIQUE INDEX `item_categories_firm_id_name_key`(`firm_id`, `name`),
    ADD UNIQUE INDEX `item_categories_firm_id_slug_key`(`firm_id`, `slug`),
    ADD INDEX `item_categories_firm_id_idx`(`firm_id`);

ALTER TABLE `measurement_units`
    DROP INDEX `measurement_units_name_key`,
    DROP INDEX `measurement_units_symbol_key`,
    ADD UNIQUE INDEX `measurement_units_firm_id_name_key`(`firm_id`, `name`),
    ADD UNIQUE INDEX `measurement_units_firm_id_symbol_key`(`firm_id`, `symbol`),
    ADD INDEX `measurement_units_firm_id_idx`(`firm_id`);

ALTER TABLE `items`
    DROP INDEX `items_item_code_key`,
    DROP INDEX `items_name_idx`,
    ADD UNIQUE INDEX `items_firm_id_item_code_key`(`firm_id`, `item_code`),
    ADD INDEX `items_firm_id_name_idx`(`firm_id`, `name`);

ALTER TABLE `quotations`
    DROP INDEX `quotations_quotation_number_revision_number_key`,
    DROP INDEX `quotations_root_quotation_id_revision_number_key`,
    DROP INDEX `quotations_quotation_date_idx`,
    ADD UNIQUE INDEX `quotations_firm_id_quotation_number_revision_number_key`(`firm_id`, `quotation_number`, `revision_number`),
    ADD UNIQUE INDEX `quotations_firm_id_root_quotation_id_revision_number_key`(`firm_id`, `root_quotation_id`, `revision_number`),
    ADD INDEX `quotations_firm_id_quotation_date_idx`(`firm_id`, `quotation_date`);

ALTER TABLE `terms_templates`
    DROP INDEX `terms_templates_term_type_idx`,
    ADD INDEX `terms_templates_firm_id_term_type_idx`(`firm_id`, `term_type`);

ALTER TABLE `import_batches`
    DROP INDEX `import_batches_status_idx`,
    ADD INDEX `import_batches_firm_id_status_idx`(`firm_id`, `status`);

ALTER TABLE `audit_logs`
    ADD INDEX `audit_logs_firm_id_created_at_idx`(`firm_id`, `created_at`);

ALTER TABLE `firm_roles`
    ADD CONSTRAINT `firm_roles_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `users`
    ADD CONSTRAINT `users_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `users_firm_role_id_fkey`
        FOREIGN KEY (`firm_role_id`) REFERENCES `firm_roles`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `business_profiles`
    ADD CONSTRAINT `business_profiles_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `companies`
    ADD CONSTRAINT `companies_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `item_categories`
    ADD CONSTRAINT `item_categories_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `measurement_units`
    ADD CONSTRAINT `measurement_units_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `items`
    ADD CONSTRAINT `items_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `quotations`
    ADD CONSTRAINT `quotations_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `terms_templates`
    ADD CONSTRAINT `terms_templates_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `import_batches`
    ADD CONSTRAINT `import_batches_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `audit_logs`
    ADD CONSTRAINT `audit_logs_firm_id_fkey`
        FOREIGN KEY (`firm_id`) REFERENCES `firms`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE;
