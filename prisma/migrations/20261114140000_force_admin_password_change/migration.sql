ALTER TABLE "AdminUser"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

UPDATE "AdminUser"
SET "mustChangePassword" = true
WHERE "role" = 'ADMIN';
