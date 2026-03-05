-- M35: real auth user roles + login fields
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';

ALTER TABLE "User"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
