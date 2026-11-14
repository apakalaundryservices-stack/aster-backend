import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function requireInitialPassword(name) {
  const value = process.env[name];
  if (!value || value.startsWith("replace-") || value.length < 12) {
    throw new Error(`${name} must be set to a unique password of at least 12 characters in .env.`);
  }
  return value;
}

async function seedUser(emailName, passwordName, role, name) {
  const email = process.env[emailName]?.trim().toLowerCase();
  if (!email) throw new Error(`${emailName} must be set in .env.`);

  const passwordHash = await bcrypt.hash(requireInitialPassword(passwordName), 12);
  await prisma.adminUser.upsert({
    where: { email },
    update: { name, passwordHash, role, active: true },
    create: { email, name, passwordHash, role }
  });
}

async function main() {
  await seedUser("ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN", "Aster Suites Administrator");
  await seedUser("STAFF_EMAIL", "STAFF_PASSWORD", "STAFF", "Aster Suites Staff");

  const rooms = [
    {
      slug: "single-room",
      name: "Single Room",
      description: "Room details and features need owner confirmation.",
      roomType: "SINGLE",
      bedType: "Single bed",
      bedCount: 1,
      maxGuests: 1,
      sizeSqm: null,
      inventory: 2,
      nightlyRate: 2500,
      ownerConfirmed: false,
      notes: "Confirm capacity, room count, bed type, amenities and rate."
    },
    {
      slug: "double-twin-room",
      name: "Double / Twin Room",
      description: "Room details and features need owner confirmation.",
      roomType: "DOUBLE_TWIN",
      bedType: "Double or twin",
      bedCount: 1,
      maxGuests: 2,
      sizeSqm: null,
      inventory: 2,
      nightlyRate: 3500,
      ownerConfirmed: false,
      notes: "Confirm capacity, room count, bed type, amenities and rate."
    },
    {
      slug: "double-private-bathroom",
      name: "Double Room with Private Bathroom",
      description: "Room details and features need owner confirmation.",
      roomType: "DOUBLE_ENSUITE",
      bedType: "Double bed",
      bedCount: 1,
      maxGuests: 2,
      sizeSqm: null,
      inventory: 1,
      nightlyRate: 4500,
      ownerConfirmed: false,
      notes: "Confirm capacity, room count, bed type, amenities and rate."
    }
  ];

  for (const room of rooms) {
    await prisma.room.upsert({
      where: { slug: room.slug },
      update: {},
      create: room
    });
  }

  const roomPhotos = {
    "single-room": [
      { url: "/images/room-bedroom-06.jpg", alt: "Bedroom shown in a supplied Aster Suites photo." },
      { url: "/images/room-bedroom-07.jpg", alt: "Bedroom shown in a supplied Aster Suites photo." }
    ],
    "double-twin-room": [
      { url: "/images/room-bedroom-01.jpg", alt: "Bedroom shown in a supplied Aster Suites photo." },
      { url: "/images/room-bedroom-02.jpg", alt: "Bedroom shown in a supplied Aster Suites photo." }
    ],
    "double-private-bathroom": [
      { url: "/images/room-bedroom-03.jpg", alt: "Bedroom shown in a supplied Aster Suites photo." },
      { url: "/images/room-bedroom-04.jpg", alt: "Bedroom shown in a supplied Aster Suites photo." },
      { url: "/images/bathroom-01.jpg", alt: "Bathroom shown in a supplied Aster Suites photo; room association is unconfirmed." }
    ]
  };
  for (const [slug, photos] of Object.entries(roomPhotos)) {
    const room = await prisma.room.findUnique({ where: { slug } });
    for (const [position, photo] of photos.entries()) {
      await prisma.roomImage.upsert({
        where: { roomId_url: { roomId: room.id, url: photo.url } },
        update: { alt: photo.alt, position },
        create: { roomId: room.id, ...photo, position }
      });
    }
  }

  const meals = [
    { id: "seed-breakfast", name: "Breakfast", description: "Availability, ingredients and price need owner confirmation.", price: 600 },
    { id: "seed-lunch", name: "Lunch", description: "Availability, ingredients and price need owner confirmation.", price: 900 },
    { id: "seed-dinner", name: "Dinner", description: "Availability, ingredients and price need owner confirmation.", price: 1100 }
  ];
  for (const meal of meals) {
    await prisma.meal.upsert({
      where: { id: meal.id },
      update: {},
      create: { ...meal, ownerConfirmed: false }
    });
  }

  const paymentMode = process.env.PAYMENT_MODE || "BOTH";
  if (!["BOTH", "CASH_ONLY", "MPESA"].includes(paymentMode)) {
    throw new Error("PAYMENT_MODE must be BOTH, CASH_ONLY, or MPESA.");
  }
  await prisma.systemSetting.upsert({
    where: { key: "paymentMode" },
    update: { value: paymentMode },
    create: { key: "paymentMode", value: paymentMode }
  });
}

main()
  .then(() => console.log("Initial accounts and property listings are ready. Confirm all listing details before publishing."))
  .catch((error) => {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
