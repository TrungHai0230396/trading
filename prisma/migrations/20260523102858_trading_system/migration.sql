-- AlterTable
ALTER TABLE `TradeJournal` ADD COLUMN `systemChecks` JSON NULL,
    ADD COLUMN `tradingSystemId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `TradingSystem` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TradingSystem_userId_archived_idx`(`userId`, `archived`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TradingSystemItem` (
    `id` VARCHAR(191) NOT NULL,
    `systemId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `order` INTEGER NOT NULL DEFAULT 0,

    INDEX `TradingSystemItem_systemId_order_idx`(`systemId`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `TradeJournal_tradingSystemId_idx` ON `TradeJournal`(`tradingSystemId`);

-- AddForeignKey
ALTER TABLE `TradeJournal` ADD CONSTRAINT `TradeJournal_tradingSystemId_fkey` FOREIGN KEY (`tradingSystemId`) REFERENCES `TradingSystem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TradingSystem` ADD CONSTRAINT `TradingSystem_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TradingSystemItem` ADD CONSTRAINT `TradingSystemItem_systemId_fkey` FOREIGN KEY (`systemId`) REFERENCES `TradingSystem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
