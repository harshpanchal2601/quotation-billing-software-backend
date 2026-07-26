-- Allow immutable quotation revisions under a shared base quotation number.
ALTER TABLE `quotations` DROP INDEX `quotations_quotation_number_key`;

ALTER TABLE `quotations`
  ADD COLUMN `root_quotation_id` INTEGER NULL,
  ADD COLUMN `previous_revision_id` INTEGER NULL,
  ADD COLUMN `is_latest_revision` BOOLEAN NOT NULL DEFAULT true;

UPDATE `quotations`
SET `root_quotation_id` = `id`,
    `is_latest_revision` = true
WHERE `root_quotation_id` IS NULL;

CREATE UNIQUE INDEX `quotations_quotation_number_revision_number_key`
  ON `quotations`(`quotation_number`, `revision_number`);

CREATE UNIQUE INDEX `quotations_root_quotation_id_revision_number_key`
  ON `quotations`(`root_quotation_id`, `revision_number`);

CREATE UNIQUE INDEX `quotations_previous_revision_id_key`
  ON `quotations`(`previous_revision_id`);

CREATE INDEX `quotations_root_quotation_id_idx`
  ON `quotations`(`root_quotation_id`);

CREATE INDEX `quotations_is_latest_revision_idx`
  ON `quotations`(`is_latest_revision`);

ALTER TABLE `quotations`
  ADD CONSTRAINT `quotations_root_quotation_id_fkey`
    FOREIGN KEY (`root_quotation_id`) REFERENCES `quotations`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `quotations_previous_revision_id_fkey`
    FOREIGN KEY (`previous_revision_id`) REFERENCES `quotations`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
