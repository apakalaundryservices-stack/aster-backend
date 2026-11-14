import { Router } from "express";
import { z } from "zod";
import { HttpError, parseBody } from "../lib/errors.js";
import { makeReference, normalizeKenyanPhone, getAvailability, createBooking, changeBookingStatus } from "../services/bookings.js";
import { getPaymentMode, paymentMethodAllowed } from "../services/settings.js";
import { optionalCustomerAuth, writeAuditLog } from "../lib/security.js";
import { maskPhone } from "../lib/privacy.js";

const nonEmpty = (max) => z.string().trim().min(1).max(max);
const emailValue = z.string().trim().email().max(254).optional().or(z.literal(""));
const dateValue = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bookingSchema = z.object({
  roomId: nonEmpty(80),
  guestName: nonEmpty(120),
  email: emailValue,
  phone: nonEmpty(40),
  checkIn: dateValue,
  checkOut: dateValue,
  guests: z.coerce.number().int().min(1).max(10),
  paymentMethod: z.enum(["CASH", "MPESA"]).optional(),
  guestNotes: z.string().trim().max(1000).optional()
}).strict();

const lookupSchema = z.object({
  reference: nonEmpty(20),
  phone: nonEmpty(40)
}).strict();

const contactSchema = z.object({
  name: nonEmpty(120),
  email: emailValue,
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  subject: nonEmpty(160),
  message: nonEmpty(2000)
}).strict().refine((value) => Boolean(value.email || value.phone), {
  message: "Add either an email address or a phone number.",
  path: ["email"]
});

const serviceRequestSchema = z.object({
  reference: z.string().trim().max(20).optional().or(z.literal("")),
  guestName: nonEmpty(120),
  phone: nonEmpty(40),
  requestType: z.enum(["HOUSEKEEPING", "MAINTENANCE", "MEAL", "ACCESSIBILITY", "OTHER"]),
  details: nonEmpty(1000)
}).strict();

const mealOrderSchema = z.object({
  reference: nonEmpty(20),
  phone: nonEmpty(40),
  notes: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    mealId: nonEmpty(80),
    quantity: z.coerce.number().int().min(1).max(20)
  }).strict()).min(1).max(20)
}).strict();

export function createPublicApi(db, env = process.env) {
  const router = Router();
  const optionalCustomer = optionalCustomerAuth(db, env);

  router.get("/site-config", async (request, response) => {
    response.json({
      paymentMode: await getPaymentMode(db, env),
      contact: { phone: "0724 266808", whatsapp: "254724266808", location: "R3PG+6VQ, Awasi" }
    });
  });

  router.get("/rooms", async (request, response) => {
    const rooms = await db.room.findMany({
      where: { status: "ACTIVE" },
      include: { images: { orderBy: { position: "asc" } } },
      orderBy: [{ nightlyRate: "asc" }, { name: "asc" }]
    });
    response.json(rooms.map((room) => ({
      id: room.id,
      slug: room.slug,
      name: room.name,
      description: room.description,
      roomType: room.roomType,
      bedType: room.bedType,
      bedCount: room.bedCount,
      maxGuests: room.maxGuests,
      sizeSqm: room.sizeSqm,
      nightlyRate: room.ownerConfirmed ? room.nightlyRate : null,
      currency: room.currency,
      ownerConfirmed: room.ownerConfirmed,
      images: room.images.map(({ url, alt }) => ({ url, alt }))
    })));
  });

  router.get("/offers", async (request, response) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const offers = await db.offer.findMany({
      where: { active: true, endDate: { gte: today } },
      orderBy: [{ startDate: "asc" }, { discountPercent: "desc" }],
      take: 6
    });
    response.json(offers.map((offer) => ({
      id: offer.id,
      title: offer.title,
      description: offer.description,
      discountPercent: offer.discountPercent,
      startDate: offer.startDate.toISOString().slice(0, 10),
      endDate: offer.endDate.toISOString().slice(0, 10)
    })));
  });

  router.get("/availability", async (request, response) => {
    const query = z.object({
      checkIn: dateValue,
      checkOut: dateValue,
      guests: z.coerce.number().int().min(1).max(10)
    }).safeParse(request.query);
    if (!query.success) {
      return response.status(400).json({
        error: "Please provide valid check-in, check-out, and guest values."
      });
    }
    const availability = await getAvailability(db, query.data.checkIn, query.data.checkOut, query.data.guests);
    return response.json(availability);
  });

  router.get("/meals", async (request, response) => {
    const meals = await db.meal.findMany({
      where: { available: true, ownerConfirmed: true },
      select: { id: true, name: true, description: true, price: true, currency: true, ownerConfirmed: true },
      orderBy: { name: "asc" }
    });
    response.json(meals);
  });

  router.get("/reviews", async (request, response) => {
    const reviews = await db.review.findMany({
      where: { approved: true },
      select: { id: true, guestName: true, rating: true, text: true, source: true },
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      take: 12
    });
    response.json(reviews);
  });

  router.post("/bookings", optionalCustomer, async (request, response) => {
    const data = parseBody(bookingSchema, request, response);
    if (!data) return;
    const mode = await getPaymentMode(db, env);
    const method = data.paymentMethod || (mode === "MPESA" ? "MPESA" : "CASH");
    if (!paymentMethodAllowed(mode, method)) {
      throw new HttpError(409, `The selected payment method is not enabled. Current mode: ${mode}.`);
    }
    const booking = await createBooking(db, data, method, request.customer?.id || null);
    response.status(201).json({
      reference: booking.reference,
      status: booking.status,
      room: booking.room.name,
      ownerConfirmed: booking.room.ownerConfirmed,
      checkIn: booking.checkIn.toISOString().slice(0, 10),
      checkOut: booking.checkOut.toISOString().slice(0, 10),
      nights: booking.nights,
      guests: booking.guests,
      ratePerNight: booking.ratePerNight,
      subtotalAmount: booking.subtotalAmount,
      discountAmount: booking.discountAmount,
      offerTitle: booking.offerTitle,
      offerDiscountPercent: booking.offerDiscountPercent,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      paymentMethod: method,
      holdExpiresAt: booking.holdExpiresAt,
      customerLinked: Boolean(booking.customerId)
    });
  });

  router.post("/bookings/lookup", async (request, response) => {
    const data = parseBody(lookupSchema, request, response);
    if (!data) return;
    const phone = normalizeKenyanPhone(data.phone);
    const booking = await db.booking.findFirst({
      where: { reference: data.reference.trim().toUpperCase(), phone },
      include: {
        room: { select: { name: true } },
        payments: { select: { method: true, status: true, amount: true, currency: true, createdAt: true } }
      }
    });
    if (!booking) throw new HttpError(404, "Booking not found. Check the reference and phone number.");
    response.json({
      reference: booking.reference,
      guestName: booking.guestName,
      room: booking.room.name,
      checkIn: booking.checkIn.toISOString().slice(0, 10),
      checkOut: booking.checkOut.toISOString().slice(0, 10),
      guests: booking.guests,
      nights: booking.nights,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      status: booking.status,
      phone: maskPhone(booking.phone),
      payments: booking.payments.map((payment) => ({
        method: payment.method,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        createdAt: payment.createdAt
      }))
    });
  });

  router.post("/bookings/cancel", async (request, response) => {
    const data = parseBody(lookupSchema, request, response);
    if (!data) return;
    const phone = normalizeKenyanPhone(data.phone);
    const booking = await db.booking.findFirst({
      where: { reference: data.reference.trim().toUpperCase(), phone },
      include: { payments: { where: { status: "SUCCESS" }, select: { id: true } } }
    });
    if (!booking) throw new HttpError(404, "Booking not found. Check the reference and phone number.");
    if (booking.payments.length) {
      throw new HttpError(409, "A paid booking must be cancelled by staff so the payment can be reviewed.");
    }
    if (!["PENDING", "CONFIRMED"].includes(booking.status)) {
      throw new HttpError(409, `This booking cannot be cancelled while it is ${booking.status.toLowerCase()}.`);
    }
    await changeBookingStatus(db, booking.id, "CANCELLED");
    await writeAuditLog(db, request, "booking.cancelled_by_guest", "Booking", booking.id);
    response.json({ reference: booking.reference, status: "CANCELLED" });
  });

  router.post("/meal-orders", async (request, response) => {
    const data = parseBody(mealOrderSchema, request, response);
    if (!data) return;
    const phone = normalizeKenyanPhone(data.phone);
    const booking = await db.booking.findFirst({
      where: {
        reference: data.reference.trim().toUpperCase(),
        phone,
        status: { in: ["CONFIRMED", "CHECKED_IN"] }
      }
    });
    if (!booking) throw new HttpError(404, "An active booking matching those details was not found.");
    const mealIds = [...new Set(data.items.map((item) => item.mealId))];
    if (mealIds.length !== data.items.length) throw new HttpError(400, "Each menu item can appear only once.");
    const meals = await db.meal.findMany({ where: { id: { in: mealIds }, available: true, ownerConfirmed: true } });
    if (meals.length !== mealIds.length) throw new HttpError(400, "One or more selected menu items are unavailable.");

    const mealById = new Map(meals.map((meal) => [meal.id, meal]));
    const items = data.items.map((item) => ({
      mealId: item.mealId,
      quantity: item.quantity,
      unitPrice: mealById.get(item.mealId).price
    }));
    const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const order = await db.mealOrder.create({
      data: {
        reference: makeReference("MEAL"),
        bookingId: booking.id,
        guestName: booking.guestName,
        guestPhone: booking.phone,
        notes: data.notes || null,
        total,
        items: { create: items }
      },
      select: { reference: true, status: true, total: true, currency: true }
    });
    response.status(201).json(order);
  });

  router.post("/service-requests", async (request, response) => {
    const data = parseBody(serviceRequestSchema, request, response);
    if (!data) return;
    const phone = normalizeKenyanPhone(data.phone);
    let booking = null;
    if (data.reference) {
      booking = await db.booking.findFirst({
        where: { reference: data.reference.trim().toUpperCase(), phone },
        select: { id: true }
      });
      if (!booking) throw new HttpError(404, "Booking not found. Check the reference and phone number.");
    }
    const serviceRequest = await db.serviceRequest.create({
      data: {
        bookingId: booking?.id,
        guestName: data.guestName,
        guestPhone: phone,
        requestType: data.requestType,
        details: data.details
      },
      select: { id: true, requestType: true, status: true, createdAt: true }
    });
    response.status(201).json(serviceRequest);
  });

  router.post("/contact-messages", async (request, response) => {
    const data = parseBody(contactSchema, request, response);
    if (!data) return;
    const phone = data.phone ? normalizeKenyanPhone(data.phone) : null;
    const message = await db.contactMessage.create({
      data: {
        name: data.name,
        email: data.email?.toLowerCase() || null,
        phone,
        subject: data.subject,
        message: data.message
      },
      select: { id: true, status: true, createdAt: true }
    });
    response.status(201).json({ ...message, message: "Your message has been received." });
  });

  return router;
}
