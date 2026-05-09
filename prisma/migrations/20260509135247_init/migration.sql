-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TradingAccount` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `broker` VARCHAR(191) NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `startingBalance` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TradingAccount_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Strategy` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Strategy_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,

    UNIQUE INDEX `Tag_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TradeJournal` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NULL,
    `strategyId` VARCHAR(191) NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `market` ENUM('FOREX', 'CRYPTO', 'STOCK', 'COMMODITY', 'INDEX', 'OTHER') NOT NULL DEFAULT 'FOREX',
    `direction` ENUM('LONG', 'SHORT') NOT NULL,
    `status` ENUM('OPEN', 'CLOSED', 'CANCELED') NOT NULL DEFAULT 'OPEN',
    `timeframe` VARCHAR(191) NULL,
    `entryPrice` DECIMAL(20, 8) NOT NULL,
    `exitPrice` DECIMAL(20, 8) NULL,
    `stopLoss` DECIMAL(20, 8) NULL,
    `takeProfit` DECIMAL(20, 8) NULL,
    `lotSize` DECIMAL(20, 8) NOT NULL,
    `riskAmount` DECIMAL(20, 4) NULL,
    `rMultiple` DECIMAL(10, 4) NULL,
    `pnl` DECIMAL(20, 4) NULL,
    `feesAmount` DECIMAL(20, 4) NULL,
    `openedAt` DATETIME(3) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `setup` TEXT NULL,
    `notes` TEXT NULL,
    `mistakes` TEXT NULL,
    `emotion` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TradeJournal_userId_openedAt_idx`(`userId`, `openedAt`),
    INDEX `TradeJournal_userId_status_idx`(`userId`, `status`),
    INDEX `TradeJournal_symbol_idx`(`symbol`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TradeJournalTag` (
    `tradeId` VARCHAR(191) NOT NULL,
    `tagId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`tradeId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TradeScreenshot` (
    `id` VARCHAR(191) NOT NULL,
    `tradeId` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `caption` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TradeScreenshot_tradeId_idx`(`tradeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WatchlistSymbol` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `market` ENUM('FOREX', 'CRYPTO', 'STOCK', 'COMMODITY', 'INDEX', 'OTHER') NOT NULL DEFAULT 'CRYPTO',
    `exchange` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WatchlistSymbol_userId_idx`(`userId`),
    UNIQUE INDEX `WatchlistSymbol_userId_symbol_market_key`(`userId`, `symbol`, `market`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnalysisRun` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `market` ENUM('FOREX', 'CRYPTO', 'STOCK', 'COMMODITY', 'INDEX', 'OTHER') NOT NULL,
    `symbols` JSON NOT NULL,
    `timeframes` JSON NOT NULL,
    `indicators` JSON NOT NULL,
    `config` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AnalysisRun_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AnalysisResult` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `timeframe` VARCHAR(191) NOT NULL,
    `signal` VARCHAR(191) NOT NULL,
    `score` DOUBLE NULL,
    `indicators` JSON NOT NULL,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AnalysisResult_runId_signal_idx`(`runId`, `signal`),
    INDEX `AnalysisResult_symbol_timeframe_idx`(`symbol`, `timeframe`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NewsArticle` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NULL,
    `title` VARCHAR(512) NOT NULL,
    `url` TEXT NOT NULL,
    `publishedAt` DATETIME(3) NOT NULL,
    `rawContent` LONGTEXT NULL,
    `summary` TEXT NULL,
    `sentiment` VARCHAR(191) NULL,
    `impact` VARCHAR(191) NULL,
    `tags` JSON NULL,
    `aiModel` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `NewsArticle_externalId_key`(`externalId`),
    INDEX `NewsArticle_publishedAt_idx`(`publishedAt`),
    INDEX `NewsArticle_source_idx`(`source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OnchainReport` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `chain` ENUM('ETH', 'BSC', 'ARBITRUM', 'POLYGON', 'SOLANA', 'OTHER') NOT NULL,
    `targetType` ENUM('WALLET', 'TOKEN', 'TRANSACTION') NOT NULL,
    `target` VARCHAR(128) NOT NULL,
    `rawData` JSON NULL,
    `summary` TEXT NULL,
    `riskLevel` VARCHAR(191) NULL,
    `insights` JSON NULL,
    `aiModel` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OnchainReport_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `OnchainReport_chain_target_idx`(`chain`, `target`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiKey` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` ENUM('GEMINI', 'TWELVE_DATA', 'CRYPTOPANIC', 'ETHERSCAN', 'BSCSCAN', 'COINGECKO', 'CUSTOM') NOT NULL,
    `label` VARCHAR(191) NULL,
    `encrypted` TEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ApiKey_userId_idx`(`userId`),
    UNIQUE INDEX `ApiKey_userId_kind_label_key`(`userId`, `kind`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppSetting` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AppSetting_userId_key_key`(`userId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TradingAccount` ADD CONSTRAINT `TradingAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Strategy` ADD CONSTRAINT `Strategy_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tag` ADD CONSTRAINT `Tag_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TradeJournal` ADD CONSTRAINT `TradeJournal_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TradeJournal` ADD CONSTRAINT `TradeJournal_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `TradingAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TradeJournal` ADD CONSTRAINT `TradeJournal_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `Strategy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TradeJournalTag` ADD CONSTRAINT `TradeJournalTag_tradeId_fkey` FOREIGN KEY (`tradeId`) REFERENCES `TradeJournal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TradeJournalTag` ADD CONSTRAINT `TradeJournalTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TradeScreenshot` ADD CONSTRAINT `TradeScreenshot_tradeId_fkey` FOREIGN KEY (`tradeId`) REFERENCES `TradeJournal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WatchlistSymbol` ADD CONSTRAINT `WatchlistSymbol_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnalysisRun` ADD CONSTRAINT `AnalysisRun_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AnalysisResult` ADD CONSTRAINT `AnalysisResult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `AnalysisRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NewsArticle` ADD CONSTRAINT `NewsArticle_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OnchainReport` ADD CONSTRAINT `OnchainReport_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppSetting` ADD CONSTRAINT `AppSetting_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
