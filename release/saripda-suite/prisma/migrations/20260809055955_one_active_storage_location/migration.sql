-- Closes a real (if low-probability) race condition found while testing
-- the first-run setup wizard (Section 10 phase 3): addInitialStorageLocation
-- checked "is there already an active StorageLocation?" and only created
-- one if not, with no transaction or DB-level guarantee between the check
-- and the write — two concurrent submissions could both pass the check
-- before either commits. Fired two genuinely concurrent requests at it
-- (via two synthetic Windows drives) and it happened not to reproduce, but
-- "happened not to" isn't a guarantee. A partial unique index makes it one
-- at the database level instead of relying on timing.
CREATE UNIQUE INDEX "one_active_storage_location" ON "StorageLocation"("isActive") WHERE "isActive" = 1;