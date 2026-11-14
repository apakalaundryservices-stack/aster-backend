ALTER TABLE "Room" RENAME COLUMN "demoOnly" TO "ownerConfirmed";
ALTER TABLE "Room" ALTER COLUMN "ownerConfirmed" SET DEFAULT false;
UPDATE "Room" SET "ownerConfirmed" = NOT "ownerConfirmed";

ALTER TABLE "Meal" RENAME COLUMN "demoOnly" TO "ownerConfirmed";
ALTER TABLE "Meal" ALTER COLUMN "ownerConfirmed" SET DEFAULT false;
UPDATE "Meal" SET "ownerConfirmed" = NOT "ownerConfirmed";

UPDATE "Room"
SET
    "slug" = CASE "slug"
        WHEN 'demo-single' THEN 'single-room'
        WHEN 'demo-double-twin' THEN 'double-twin-room'
        WHEN 'demo-double-private-bathroom' THEN 'double-private-bathroom'
        ELSE "slug"
    END,
    "name" = CASE "slug"
        WHEN 'demo-single' THEN 'Single Room'
        WHEN 'demo-double-twin' THEN 'Double / Twin Room'
        WHEN 'demo-double-private-bathroom' THEN 'Double Room with Private Bathroom'
        ELSE "name"
    END,
    "bedType" = CASE "slug"
        WHEN 'demo-single' THEN 'Single bed'
        WHEN 'demo-double-twin' THEN 'Double or twin'
        WHEN 'demo-double-private-bathroom' THEN 'Double bed'
        ELSE "bedType"
    END,
    "description" = 'Room details and features need owner confirmation.',
    "notes" = 'Confirm capacity, room count, bed type, amenities and rate.'
WHERE "slug" IN ('demo-single', 'demo-double-twin', 'demo-double-private-bathroom');

UPDATE "Meal"
SET
    "id" = CASE "id"
        WHEN 'demo-breakfast' THEN 'seed-breakfast'
        WHEN 'demo-lunch' THEN 'seed-lunch'
        WHEN 'demo-dinner' THEN 'seed-dinner'
        ELSE "id"
    END,
    "name" = CASE "id"
        WHEN 'demo-breakfast' THEN 'Breakfast'
        WHEN 'demo-lunch' THEN 'Lunch'
        WHEN 'demo-dinner' THEN 'Dinner'
        ELSE "name"
    END,
    "description" = 'Availability, ingredients and price need owner confirmation.'
WHERE "id" IN ('demo-breakfast', 'demo-lunch', 'demo-dinner');

UPDATE "AdminUser"
SET "name" = CASE "name"
    WHEN 'Demo Administrator' THEN 'Aster Suites Administrator'
    WHEN 'Demo Staff' THEN 'Aster Suites Staff'
    ELSE "name"
END
WHERE "name" IN ('Demo Administrator', 'Demo Staff');
