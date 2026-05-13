-- Alter TradeScreenshot.url to LONGTEXT to allow large data URLs
ALTER TABLE `TradeScreenshot` MODIFY `url` LONGTEXT NOT NULL;
