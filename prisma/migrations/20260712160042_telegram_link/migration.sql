-- AlterTable
ALTER TABLE `User` ADD COLUMN `telegramChatId` VARCHAR(191) NULL,
    ADD COLUMN `telegramLinkedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `User_telegramChatId_idx` ON `User`(`telegramChatId`);
