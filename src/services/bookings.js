import { randomBytes } from "node:crypto";
import { HttpError } from "../lib/errors.js";

const dayMs = 24 * 60 * 60 * 1000;
const activeStatuses = ["CONFIRMED", "CHECKED_IN"];

export function normalizeKenyanPhone(input) {
  if (typeof input !== "string") throw new HttpError(400, "Enter a valid Kenyan mobile number.");
  const compact = input.replace(/[()\s-]/g, "");
  const normalized = compact.startsWith("+") ? compact.slice(1) : compact;
  const international = normalized.startsWith("0") ? `254${normalized.slice(1)}` : normalized;
  if (!/^254[17]\d{8}$/.test(international)) {
    throw new HttpError(400, "Enter a valid Kenyan mobile number, for example 0712 345 678.");
  }
  return international;
}

export function parseDateOnly(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${fieldName} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${fieldName} is not a valid date.`);
  }
  return date;
}

export function countNights(checkIn, checkOut) {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / dayMs);
}

function kenyaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day)));
}

export function makeReference(prefix = "AS") {
  return `${prefix}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function overlappingWhere(roomId, checkIn, checkOut, now, excludeId) {
  return {
    roomId,
    ...(excludeId ? { id: { not: excludeId } } : {}),
    checkIn: { lt: checkOut },
    checkOut: { gt: checkIn },
    OR: [
      { status: { in: activeStatuses } },
      { status: "PENDING", holdExpiresAt: { gt: now } }
    ]
  };
}

export async function getAvailability(db, checkInValue, checkOutValue, guests) {
  const checkIn = parseDateOnly(checkInValue, "Check-in date");
  const checkOut = parseDateOnly(checkOutValue, "Check-out date");
  const nights = countNights(checkIn, checkOut);
  const now = new Date();
  if (checkIn < kenyaToday(now)) throw new HttpError(400, "Check-in date cannot be in the past.");
  if (nights < 1 || nights > 30) throw new HttpError(400, "Choose a stay between 1 and 30 nights.");
  if (!Number.isInteger(guests) || guests < 1 || guests > 10) throw new HttpError(400, "Guest count must be between 1 and 10.");

  const [rooms, offer] = await Promise.all([
    db.room.findMany({
    where: { status: "ACTIVE", ownerConfirmed: true, maxGuests: { gte: guests } },
    include: { images: { orderBy: { position: "asc" }, take: 1 } },
    orderBy: [{ nightlyRate: "asc" }, { name: "asc" }]
    }),
    db.offer.findFirst({
      where: { active: true, startDate: { lte: checkIn }, endDate: { gte: checkOut } },
      orderBy: [{ discountPercent: "desc" }, { createdAt: "asc" }]
    })
  ]);
  const discountPercent = offer?.discountPercent || 0;
  const result = [];
  for (const room of rooms) {
    const booked = await db.booking.count({
      where: overlappingWhere(room.id, checkIn, checkOut, now)
    });
    result.push({
      id: room.id,
      slug: room.slug,
      name: room.name,
      description: room.description,
      roomType: room.roomType,
      bedType: room.bedType,
      bedCount: room.bedCount,
      maxGuests: room.maxGuests,
      sizeSqm: room.sizeSqm,
      nightlyRate: Math.round(room.nightlyRate * (100 - discountPercent) / 100),
      originalNightlyRate: room.nightlyRate,
      offer: offer ? { id: offer.id, title: offer.title, discountPercent } : null,
      currency: room.currency,
      ownerConfirmed: room.ownerConfirmed,
      image: room.images[0] || null,
      available: Math.max(0, room.inventory - booked),
      total: room.inventory
    });
  }
  return { checkIn, checkOut, nights, rooms: result };
}

export async function createBooking(db, data, paymentMethod, customerId = null) {
  const checkIn = parseDateOnly(data.checkIn, "Check-in date");
  const checkOut = parseDateOnly(data.checkOut, "Check-out date");
  const nights = countNights(checkIn, checkOut);
  const now = new Date();
  if (checkIn < kenyaToday(now)) throw new HttpError(400, "Check-in date cannot be in the past.");
  if (nights < 1 || nights > 30) throw new HttpError(400, "Choose a stay between 1 and 30 nights.");
  if (!Number.isInteger(data.guests) || data.guests < 1 || data.guests > 10) {
    throw new HttpError(400, "Guest count must be between 1 and 10.");
  }
  const phone = normalizeKenyanPhone(data.phone);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${data.roomId} FOR UPDATE`;
    const room = await tx.room.findUnique({ where: { id: data.roomId } });
    if (!room || room.status !== "ACTIVE") throw new HttpError(404, "That room is not available for booking.");
    if (!room.ownerConfirmed) throw new HttpError(409, "The property has not confirmed this room listing yet.");
    if (data.guests > room.maxGuests) throw new HttpError(400, "The selected room does not fit the guest count.");

    const offer = await tx.offer.findFirst({
      where: { active: true, startDate: { lte: checkIn }, endDate: { gte: checkOut } },
      orderBy: [{ discountPercent: "desc" }, { createdAt: "asc" }]
    });
    const ratePerNight = Math.round(room.nightlyRate * (100 - (offer?.discountPercent || 0)) / 100);
    const subtotalAmount = room.nightlyRate * nights;
    const totalAmount = ratePerNight * nights;

    const overlapping = await tx.booking.count({
      where: overlappingWhere(room.id, checkIn, checkOut, now)
    });
    if (overlapping >= room.inventory) throw new HttpError(409, "That room is no longer available for these dates.");

    const reference = makeReference();
    const holdExpiresAt = paymentMethod === "MPESA" ? new Date(Date.now() + 15 * 60 * 1000) : null;
    const booking = await tx.booking.create({
      data: {
        reference,
        roomId: room.id,
        guestName: data.guestName.trim(),
        email: data.email?.trim().toLowerCase() || null,
        phone,
        checkIn,
        checkOut,
        guests: data.guests,
        nights,
        ratePerNight,
        totalAmount,
        subtotalAmount,
        discountAmount: subtotalAmount - totalAmount,
        offerId: offer?.id || null,
        offerTitle: offer?.title || null,
        offerDiscountPercent: offer?.discountPercent || null,
        customerId,
        status: paymentMethod === "CASH" ? "CONFIRMED" : "PENDING",
        holdExpiresAt,
        guestNotes: data.guestNotes?.trim() || null,
        payments: {
          create: {
            method: paymentMethod,
            amount: totalAmount,
            status: "PENDING",
            phone: paymentMethod === "MPESA" ? phone : null
          }
        }
      },
      include: { room: { select: { name: true, ownerConfirmed: true } } }
    });

    return booking;
  }, { isolationLevel: "Serializable" });
}

export async function changeBookingStatus(db, bookingId, status) {
  return db.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new HttpError(404, "Booking not found.");
    await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${booking.roomId} FOR UPDATE`;

    const transitions = {
      PENDING: ["CONFIRMED", "CANCELLED", "REJECTED"],
      CONFIRMED: ["CHECKED_IN", "CANCELLED", "REJECTED"],
      CHECKED_IN: ["CHECKED_OUT"],
      CHECKED_OUT: [],
      CANCELLED: [],
      REJECTED: []
    };
    if (!transitions[booking.status]?.includes(status)) {
      throw new HttpError(409, `Cannot change booking status from ${booking.status} to ${status}.`);
    }
    if (status === "CONFIRMED") {
      const overlap = await tx.booking.count({
        where: overlappingWhere(booking.roomId, booking.checkIn, booking.checkOut, new Date(), booking.id)
      });
      const room = await tx.room.findUnique({ where: { id: booking.roomId } });
      if (overlap >= room.inventory) throw new HttpError(409, "This booking now conflicts with another reservation.");
    }
    return tx.booking.update({
      where: { id: booking.id },
      data: {
        status,
        ...(status === "CONFIRMED" || status === "CANCELLED" || status === "REJECTED"
          ? { holdExpiresAt: null }
          : {})
      }
    });
  }, { isolationLevel: "Serializable" });
}
