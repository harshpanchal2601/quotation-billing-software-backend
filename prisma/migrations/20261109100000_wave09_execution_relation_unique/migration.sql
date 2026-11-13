-- Prisma requires the complete defining key of a one-to-one relation to be unique.
-- Existing proposal_id uniqueness already guarantees uniqueness of this tuple.
-- Add the replacement before removing the index that supports the ownership FK.
ALTER TABLE `assistant_executions`
  ADD UNIQUE INDEX `assistant_execution_owner_key` (`proposal_id`, `firm_id`, `actor_id`);

ALTER TABLE `assistant_executions`
  DROP INDEX `assistant_execution_owner_idx`;
