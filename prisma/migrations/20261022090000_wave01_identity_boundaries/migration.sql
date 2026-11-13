-- Review on a disposable MySQL database before deployment. Do not disable
-- foreign_key_checks: invalid existing assignments must stop this migration.
-- No tenant, role or financial data is reassigned or deleted.
CREATE PROCEDURE `wave01_assert_role_ownership`()
BEGIN
    IF EXISTS (
        SELECT 1 FROM `users` u
        LEFT JOIN `firm_roles` r ON r.id = u.firm_role_id AND r.firm_id = u.firm_id
        WHERE (u.firm_role_id IS NOT NULL AND r.id IS NULL)
           OR (u.account_type = 'FIRM_USER' AND (u.firm_id IS NULL OR u.firm_role_id IS NULL))
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Resolve invalid user role ownership before Wave01';
    END IF;
END;

CALL `wave01_assert_role_ownership`();
DROP PROCEDURE `wave01_assert_role_ownership`;

ALTER TABLE `firm_roles`
    ADD UNIQUE INDEX `firm_roles_id_firm_id_key` (`id`, `firm_id`);

ALTER TABLE `users`
    DROP FOREIGN KEY `users_firm_role_id_fkey`,
    ADD INDEX `users_firm_role_id_firm_id_idx` (`firm_role_id`, `firm_id`),
    ADD CONSTRAINT `users_firm_role_id_firm_id_fkey`
        FOREIGN KEY (`firm_role_id`, `firm_id`) REFERENCES `firm_roles` (`id`, `firm_id`)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Nullable composite keys otherwise permit a role with no tenant. Triggers
-- enforce this on supported MySQL versions without relying on ignored CHECKs.
CREATE TRIGGER `users_role_ownership_insert` BEFORE INSERT ON `users`
FOR EACH ROW
BEGIN
    IF (NEW.firm_role_id IS NOT NULL AND NEW.firm_id IS NULL)
       OR (NEW.account_type = 'FIRM_USER' AND (NEW.firm_id IS NULL OR NEW.firm_role_id IS NULL)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Firm user role and firm are required';
    END IF;
END;

CREATE TRIGGER `users_role_ownership_update` BEFORE UPDATE ON `users`
FOR EACH ROW
BEGIN
    IF (NEW.firm_role_id IS NOT NULL AND NEW.firm_id IS NULL)
       OR (NEW.account_type = 'FIRM_USER' AND (NEW.firm_id IS NULL OR NEW.firm_role_id IS NULL)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Firm user role and firm are required';
    END IF;
END;

-- These shapes are emitted only by the existing Platform repository. Preserve
-- the original target firm while moving legacy global events out of firm feeds.
-- Existing business events, actor IDs, timestamps and old values are retained.
UPDATE `audit_logs`
SET `new_values` = JSON_SET(COALESCE(`new_values`, JSON_OBJECT()), '$.targetFirmId', `firm_id`),
    `firm_id` = NULL
WHERE `firm_id` IS NOT NULL
  AND (`entity_type` = 'Firm'
       OR (`entity_type` = 'User'
           AND JSON_EXTRACT(`new_values`, '$.passwordResetByPlatformAdministrator') = TRUE));

-- Platform access events are append-only, including attempts to reclassify an
-- event. Snapshot actor/session/firm IDs survive FK-driven actor deletion.
CREATE TRIGGER `platform_access_event_update` BEFORE UPDATE ON `audit_logs`
FOR EACH ROW
BEGIN
    IF OLD.entity_type = 'PlatformFirmAccess' OR NEW.entity_type = 'PlatformFirmAccess' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Platform access events are immutable';
    END IF;
END;

CREATE TRIGGER `platform_access_event_delete` BEFORE DELETE ON `audit_logs`
FOR EACH ROW
BEGIN
    IF OLD.entity_type = 'PlatformFirmAccess' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Platform access events are immutable';
    END IF;
END;
