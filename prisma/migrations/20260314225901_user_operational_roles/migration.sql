-- CreateEnum
CREATE TYPE "UserOperationalRole" AS ENUM ('WORKSHOP', 'SALES', 'ADMIN', 'MIXED');

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "operationalRole" "UserOperationalRole";
