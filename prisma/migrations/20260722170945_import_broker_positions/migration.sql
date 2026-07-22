-- Read-only broker import: track source + a dedup key on journal entries.
ALTER TABLE `TradeJournal`
  ADD COLUMN `source` VARCHAR(191) NULL,
  ADD COLUMN `brokerRef` VARCHAR(191) NULL;

-- Dedup imported open positions (manual rows keep brokerRef NULL; MySQL
-- permits many NULLs in a unique index, so they never collide).
CREATE UNIQUE INDEX `TradeJournal_userId_brokerRef_key` ON `TradeJournal`(`userId`, `brokerRef`);
