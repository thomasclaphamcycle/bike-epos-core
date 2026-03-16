-- AlterTable
ALTER TABLE "ReceiptCounter" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ReceiptSettings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Refund" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RefundLine" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "app_user" RENAME CONSTRAINT "User_pkey" TO "app_user_pkey";

-- RenameIndex
ALTER INDEX "User_email_key" RENAME TO "app_user_email_key";

-- RenameIndex
ALTER INDEX "User_username_key" RENAME TO "app_user_username_key";
