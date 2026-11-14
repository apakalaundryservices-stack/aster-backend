UPDATE "Booking"
SET "subtotalAmount" = "totalAmount"
WHERE "subtotalAmount" = 0 AND "totalAmount" > 0;
