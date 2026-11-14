import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { HttpError, parseBody } from "../lib/errors.js";
import { requireAuth, requireRole, writeAuditLog } from "../lib/security.js";
import { maskEmail, maskPhone } from "../lib/privacy.js";
import { parseDateOnly, changeBookingStatus } from "../services/bookings.js";
import { getPaymentMode } from "../services/settings.js";
import { queryPaymentStatus } from "./payments-api.js";

const staff = ["ADMIN", "STAFF"];
const statuses = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "REJECTED"];

const bookingStatusSchema = z.object({ status: z.enum(statuses) }).strict();
const cashPaymentSchema = z.object({ amount: z.coerce.number().int().positive().max(10000000) }).strict();
const roomCreateSchema = z.object({
  slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(1000),
  roomType: z.string().trim().min(2).max(40),
  bedType: z.string().trim().min(2).max(80),
  bedCount: z.coerce.number().int().min(1).max(10),
  maxGuests: z.coerce.number().int().min(1).max(10),
  sizeSqm: z.coerce.number().int().positive().max(1000).nullable().optional(),
  inventory: z.coerce.number().int().min(0).max(500),
  nightlyRate: z.coerce.number().int().positive().max(10000000),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  ownerConfirmed: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional()
}).strict();
const roomUpdateSchema = roomCreateSchema.partial().strict();
const offerFields = {
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(500),
  discountPercent: z.coerce.number().int().min(1).max(90),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  active: z.boolean()
};
const offerCreateSchema = z.object({ ...offerFields, active: offerFields.active.default(false) })
  .strict()
  .refine((value) => value.endDate >= value.startDate, {
    message: "The end date must be on or after the start date.",
    path: ["endDate"]
  });
const offerUpdateSchema = z.object(offerFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
const mealUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  price: z.coerce.number().int().positive().max(1000000).optional(),
  available: z.boolean().optional(),
  ownerConfirmed: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
const requestStatusSchema = z.object({ status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED", "CANCELLED"]) }).strict();
const reviewUpdateSchema = z.object({
  approved: z.boolean(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  guestName: z.string().trim().min(1).max(120).optional(),
  text: z.string().trim().min(1).max(1000).optional(),
  source: z.string().trim().max(250).nullable().optional()
}).strict();
const reviewCreateSchema = z.object({
  guestName: z.string().trim().min(1).max(120),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().min(1).max(1000),
  source: z.string().trim().max(250).optional(),
  approved: z.boolean().default(false)
}).strict();
const paymentModeSchema = z.object({ paymentMode: z.enum(["BOTH", "CASH_ONLY", "MPESA"]) }).strict();
const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200),
  role: z.enum(["ADMIN", "STAFF"])
}).strict();
const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["ADMIN", "STAFF"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(12).max(200).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export function createAdminApi(db, env = process.env) {
  const router = Router();
  router.use(requireAuth(db, env));

  router.get("/summary", requireRole(...staff), async (request, response) => {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const [
      arrivalsToday,
      activeBookings,
      pendingBookings,
      newMealOrders,
      openServiceRequests,
      openMessages,
      payments
    ] = await Promise.all([
      db.booking.count({ where: { checkIn: { gte: today, lt: tomorrow }, status: { in: ["CONFIRMED", "CHECKED_IN"] } } }),
      db.booking.count({ where: { status: { in: ["CONFIRMED", "CHECKED_IN"] } } }),
      db.booking.count({ where: { status: "PENDING" } }),
      db.mealOrder.count({ where: { status: "NEW" } }),
      db.serviceRequest.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] } } }),
      db.contactMessage.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] } } }),
      db.payment.aggregate({ where: { status: "SUCCESS" }, _sum: { amount: true } })
    ]);
    response.json({
      arrivalsToday,
      activeBookings,
      pendingBookings,
      newMealOrders,
      openServiceRequests,
      openMessages,
      successfulPaymentsKes: payments._sum.amount || 0
    });
  });

  router.get("/bookings", requireRole(...staff), async (request, response) => {
    const query = z.object({
      status: z.enum(statuses).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      search: z.string().trim().max(120).optional()
    }).safeParse(request.query);
    if (!query.success) throw new HttpError(400, "Invalid booking filters.");
    const where = {
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.from || query.data.to
        ? { checkIn: { ...(query.data.from ? { gte: parseDateOnly(query.data.from, "From date") } : {}), ...(query.data.to ? { lte: parseDateOnly(query.data.to, "To date") } : {}) } }
        : {}),
      ...(query.data.search
        ? { OR: [
          { reference: { contains: query.data.search, mode: "insensitive" } },
          { guestName: { contains: query.data.search, mode: "insensitive" } },
          { phone: { contains: query.data.search } }
        ] }
        : {})
    };
    const bookings = await db.booking.findMany({
      where,
      include: {
        room: { select: { name: true } },
        payments: { select: { method: true, status: true, amount: true } }
      },
      orderBy: [{ checkIn: "asc" }, { createdAt: "desc" }],
      take: 200
    });
    response.json(bookings.map((booking) => ({
      id: booking.id,
      reference: booking.reference,
      guestName: booking.guestName,
      phone: maskPhone(booking.phone),
      room: booking.room.name,
      checkIn: booking.checkIn.toISOString().slice(0, 10),
      checkOut: booking.checkOut.toISOString().slice(0, 10),
      guests: booking.guests,
      subtotalAmount: booking.subtotalAmount,
      discountAmount: booking.discountAmount,
      offerTitle: booking.offerTitle,
      offerDiscountPercent: booking.offerDiscountPercent,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      status: booking.status,
      payments: booking.payments
    })));
  });

  router.get("/calendar", requireRole(...staff), async (request, response) => {
    const query = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    }).safeParse(request.query);
    if (!query.success) throw new HttpError(400, "Provide valid calendar start and end dates.");
    const from = parseDateOnly(query.data.from, "From date");
    const to = parseDateOnly(query.data.to, "To date");
    if (to <= from || to.getTime() - from.getTime() > 62 * 24 * 60 * 60 * 1000) {
      throw new HttpError(400, "Calendar range must be between 1 and 62 days.");
    }
    const bookings = await db.booking.findMany({
      where: {
        checkIn: { lt: to },
        checkOut: { gt: from },
        status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] }
      },
      include: { room: { select: { name: true } } },
      orderBy: [{ checkIn: "asc" }, { room: { name: "asc" } }],
      take: 500
    });
    response.json(bookings.map((booking) => ({
      reference: booking.reference,
      guestName: booking.guestName,
      room: booking.room.name,
      checkIn: booking.checkIn.toISOString().slice(0, 10),
      checkOut: booking.checkOut.toISOString().slice(0, 10),
      status: booking.status
    })));
  });

  router.get("/bookings/:id/contact", requireRole("ADMIN"), async (request, response) => {
    const booking = await db.booking.findUnique({
      where: { id: request.params.id },
      select: { id: true, guestName: true, email: true, phone: true, reference: true }
    });
    if (!booking) throw new HttpError(404, "Booking not found.");
    await writeAuditLog(db, request, "booking.contact_viewed", "Booking", booking.id);
    response.json(booking);
  });

  router.patch("/bookings/:id/status", requireRole(...staff), async (request, response) => {
    const data = parseBody(bookingStatusSchema, request, response);
    if (!data) return;
    const booking = await changeBookingStatus(db, request.params.id, data.status);
    await writeAuditLog(db, request, "booking.status_changed", "Booking", booking.id, { status: booking.status });
    response.json({ id: booking.id, reference: booking.reference, status: booking.status });
  });

  router.post("/bookings/:id/cash-payment", requireRole(...staff), async (request, response) => {
    const data = parseBody(cashPaymentSchema, request, response);
    if (!data) return;
    const mode = await getPaymentMode(db, env);
    if (mode === "MPESA") throw new HttpError(409, "Cash payments are disabled in MPESA mode.");
    const payment = await db.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: request.params.id } });
      if (!booking) throw new HttpError(404, "Booking not found.");
      if (["CANCELLED", "REJECTED", "CHECKED_OUT"].includes(booking.status)) {
        throw new HttpError(409, `Cannot record payment for a ${booking.status.toLowerCase()} booking.`);
      }
      const payments = await tx.payment.aggregate({
        where: { bookingId: booking.id, status: "SUCCESS" },
        _sum: { amount: true }
      });
      const outstanding = booking.totalAmount - (payments._sum.amount || 0);
      if (data.amount > outstanding) throw new HttpError(409, "Payment exceeds the outstanding booking balance.");
      const created = await tx.payment.create({
        data: { bookingId: booking.id, method: "CASH", status: "SUCCESS", amount: data.amount }
      });
      if (data.amount === outstanding && booking.status === "PENDING") {
        await tx.$queryRaw`SELECT "id" FROM "Room" WHERE "id" = ${booking.roomId} FOR UPDATE`;
        const room = await tx.room.findUnique({ where: { id: booking.roomId } });
        const competing = await tx.booking.count({
          where: {
            id: { not: booking.id },
            roomId: booking.roomId,
            checkIn: { lt: booking.checkOut },
            checkOut: { gt: booking.checkIn },
            OR: [
              { status: { in: ["CONFIRMED", "CHECKED_IN"] } },
              { status: "PENDING", holdExpiresAt: { gt: new Date() } }
            ]
          }
        });
        if (competing >= room.inventory) {
          throw new HttpError(409, "This booking now conflicts with another reservation.");
        }
        await tx.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED", holdExpiresAt: null } });
      }
      return created;
    }, { isolationLevel: "Serializable" });
    await writeAuditLog(db, request, "payment.cash_recorded", "Payment", payment.id, { amount: payment.amount });
    response.status(201).json({ id: payment.id, status: payment.status, amount: payment.amount, currency: payment.currency });
  });

  router.get("/rooms", requireRole(...staff), async (request, response) => {
    const rooms = await db.room.findMany({
      include: { images: { orderBy: { position: "asc" } } },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });
    response.json(rooms);
  });

  router.post("/rooms", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(roomCreateSchema, request, response);
    if (!data) return;
    const room = await db.room.create({
      data: { ...data, sizeSqm: data.sizeSqm ?? null, notes: data.notes || null }
    });
    await writeAuditLog(db, request, "room.created", "Room", room.id, { slug: room.slug });
    response.status(201).json(room);
  });

  router.patch("/rooms/:id", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(roomUpdateSchema, request, response);
    if (!data) return;
    if (!Object.keys(data).length) throw new HttpError(400, "Provide at least one field to update.");
    const room = await db.room.update({
      where: { id: request.params.id },
      data: { ...data, ...(data.notes !== undefined ? { notes: data.notes || null } : {}) }
    });
    await writeAuditLog(db, request, "room.updated", "Room", room.id, { fields: Object.keys(data) });
    response.json(room);
  });

  router.get("/offers", requireRole("ADMIN"), async (request, response) => {
    const offers = await db.offer.findMany({
      orderBy: [{ active: "desc" }, { startDate: "desc" }, { createdAt: "desc" }]
    });
    response.json(offers);
  });

  router.post("/offers", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(offerCreateSchema, request, response);
    if (!data) return;
    const offer = await db.offer.create({
      data: {
        ...data,
        startDate: parseDateOnly(data.startDate, "Start date"),
        endDate: parseDateOnly(data.endDate, "End date")
      }
    });
    await writeAuditLog(db, request, "offer.created", "Offer", offer.id, { discountPercent: offer.discountPercent });
    response.status(201).json(offer);
  });

  router.patch("/offers/:id", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(offerUpdateSchema, request, response);
    if (!data) return;
    const existing = await db.offer.findUnique({ where: { id: request.params.id } });
    if (!existing) throw new HttpError(404, "Offer not found.");
    const startDate = data.startDate ? parseDateOnly(data.startDate, "Start date") : existing.startDate;
    const endDate = data.endDate ? parseDateOnly(data.endDate, "End date") : existing.endDate;
    if (endDate < startDate) throw new HttpError(400, "The end date must be on or after the start date.");
    const offer = await db.offer.update({
      where: { id: existing.id },
      data: { ...data, startDate, endDate }
    });
    await writeAuditLog(db, request, "offer.updated", "Offer", offer.id, { fields: Object.keys(data) });
    response.json(offer);
  });

  router.get("/customers", requireRole("ADMIN"), async (request, response) => {
    const customers = await db.customer.findMany({
      include: { _count: { select: { bookings: true } } },
      orderBy: { lastLoginAt: "desc" },
      take: 200
    });
    response.json(customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      lastLoginAt: customer.lastLoginAt,
      createdAt: customer.createdAt,
      bookingCount: customer._count.bookings
    })));
  });

  router.get("/meals", requireRole(...staff), async (request, response) => {
    response.json(await db.meal.findMany({ orderBy: { name: "asc" } }));
  });

  router.patch("/meals/:id", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(mealUpdateSchema, request, response);
    if (!data) return;
    const meal = await db.meal.update({ where: { id: request.params.id }, data });
    await writeAuditLog(db, request, "meal.updated", "Meal", meal.id, { fields: Object.keys(data) });
    response.json(meal);
  });

  router.get("/meal-orders", requireRole(...staff), async (request, response) => {
    const orders = await db.mealOrder.findMany({
      include: { items: { include: { meal: { select: { name: true } } } }, booking: { select: { reference: true } } },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    response.json(orders.map((order) => ({
      id: order.id,
      reference: order.reference,
      bookingReference: order.booking.reference,
      guestName: order.guestName,
      guestPhone: maskPhone(order.guestPhone),
      notes: order.notes,
      status: order.status,
      total: order.total,
      currency: order.currency,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({ name: item.meal.name, quantity: item.quantity, unitPrice: item.unitPrice }))
    })));
  });

  router.patch("/meal-orders/:id/status", requireRole(...staff), async (request, response) => {
    const data = parseBody(z.object({ status: z.enum(["NEW", "ACCEPTED", "PREPARING", "READY", "SERVED", "CANCELLED"]) }).strict(), request, response);
    if (!data) return;
    const order = await db.mealOrder.update({ where: { id: request.params.id }, data: { status: data.status } });
    await writeAuditLog(db, request, "meal_order.status_changed", "MealOrder", order.id, { status: order.status });
    response.json({ id: order.id, status: order.status });
  });

  router.get("/requests", requireRole(...staff), async (request, response) => {
    const [serviceRequests, messages] = await Promise.all([
      db.serviceRequest.findMany({ include: { booking: { select: { reference: true } } }, orderBy: { createdAt: "desc" }, take: 200 }),
      db.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 200 })
    ]);
    response.json({
      serviceRequests: serviceRequests.map((item) => ({
        id: item.id,
        bookingReference: item.booking?.reference || null,
        guestName: item.guestName,
        phone: maskPhone(item.guestPhone),
        requestType: item.requestType,
        details: item.details,
        status: item.status,
        createdAt: item.createdAt
      })),
      messages: messages.map((item) => ({
        id: item.id,
        name: item.name,
        email: maskEmail(item.email),
        phone: item.phone ? maskPhone(item.phone) : null,
        subject: item.subject,
        message: item.message,
        status: item.status,
        createdAt: item.createdAt
      }))
    });
  });

  router.get("/requests/:kind/:id/contact", requireRole("ADMIN"), async (request, response) => {
    const source = request.params.kind === "service"
      ? await db.serviceRequest.findUnique({ where: { id: request.params.id }, select: { id: true, guestName: true, guestPhone: true } })
      : request.params.kind === "message"
        ? await db.contactMessage.findUnique({ where: { id: request.params.id }, select: { id: true, name: true, email: true, phone: true } })
        : null;
    if (!source) throw new HttpError(404, "Contact record not found.");
    await writeAuditLog(db, request, "guest_contact_viewed", request.params.kind, source.id);
    response.json(source);
  });

  router.patch("/service-requests/:id/status", requireRole(...staff), async (request, response) => {
    const data = parseBody(requestStatusSchema, request, response);
    if (!data) return;
    const item = await db.serviceRequest.update({ where: { id: request.params.id }, data: { status: data.status } });
    await writeAuditLog(db, request, "service_request.status_changed", "ServiceRequest", item.id, { status: item.status });
    response.json({ id: item.id, status: item.status });
  });

  router.patch("/contact-messages/:id/status", requireRole(...staff), async (request, response) => {
    const data = parseBody(requestStatusSchema, request, response);
    if (!data) return;
    const item = await db.contactMessage.update({ where: { id: request.params.id }, data: { status: data.status } });
    await writeAuditLog(db, request, "contact_message.status_changed", "ContactMessage", item.id, { status: item.status });
    response.json({ id: item.id, status: item.status });
  });

  router.get("/payments", requireRole(...staff), async (request, response) => {
    const payments = await db.payment.findMany({
      include: { booking: { select: { reference: true, guestName: true } } },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    response.json(payments.map((payment) => ({
      id: payment.id,
      bookingReference: payment.booking.reference,
      guestName: payment.booking.guestName,
      method: payment.method,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      phone: payment.phone ? maskPhone(payment.phone) : null,
      receipt: payment.mpesaReceiptNumber,
      resultCode: payment.resultCode,
      resultDescription: payment.resultDescription,
      createdAt: payment.createdAt
    })));
  });

  router.post("/payments/:id/query", requireRole("ADMIN"), async (request, response) => {
    const result = await queryPaymentStatus(db, env, request.params.id);
    await writeAuditLog(db, request, "payment.mpesa_queried", "Payment", request.params.id, { resultCode: result.resultCode });
    response.json(result);
  });

  router.get("/reports", requireRole(...staff), async (request, response) => {
    const [bookings, payments, mealOrders, serviceRequests] = await Promise.all([
      db.booking.groupBy({ by: ["status"], _count: { _all: true } }),
      db.payment.groupBy({ by: ["method", "status"], _sum: { amount: true }, _count: { _all: true } }),
      db.mealOrder.groupBy({ by: ["status"], _count: { _all: true } }),
      db.serviceRequest.groupBy({ by: ["status"], _count: { _all: true } })
    ]);
    response.json({ bookings, payments, mealOrders, serviceRequests });
  });

  router.get("/reviews", requireRole("ADMIN"), async (request, response) => {
    response.json(await db.review.findMany({ orderBy: { createdAt: "desc" } }));
  });

  router.post("/reviews", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(reviewCreateSchema, request, response);
    if (!data) return;
    const review = await db.review.create({
      data: { ...data, source: data.source || null, approvedAt: data.approved ? new Date() : null }
    });
    await writeAuditLog(db, request, "review.created", "Review", review.id, { approved: review.approved });
    response.status(201).json(review);
  });

  router.patch("/reviews/:id", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(reviewUpdateSchema, request, response);
    if (!data) return;
    const review = await db.review.update({
      where: { id: request.params.id },
      data: { ...data, approvedAt: data.approved ? new Date() : null }
    });
    await writeAuditLog(db, request, "review.moderated", "Review", review.id, { approved: review.approved });
    response.json(review);
  });

  router.delete("/reviews/:id", requireRole("ADMIN"), async (request, response) => {
    await db.review.delete({ where: { id: request.params.id } });
    await writeAuditLog(db, request, "review.deleted", "Review", request.params.id);
    response.status(204).end();
  });

  router.get("/settings/payment-mode", requireRole("ADMIN"), async (request, response) => {
    response.json({ paymentMode: await getPaymentMode(db, env) });
  });

  router.patch("/settings/payment-mode", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(paymentModeSchema, request, response);
    if (!data) return;
    const setting = await db.systemSetting.upsert({
      where: { key: "paymentMode" },
      update: { value: data.paymentMode },
      create: { key: "paymentMode", value: data.paymentMode }
    });
    await writeAuditLog(db, request, "settings.payment_mode_changed", "SystemSetting", setting.key, { paymentMode: setting.value });
    response.json({ paymentMode: setting.value });
  });

  router.get("/users", requireRole("ADMIN"), async (request, response) => {
    response.json(await db.adminUser.findMany({
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: "asc" }
    }));
  });

  router.post("/users", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(userCreateSchema, request, response);
    if (!data) return;
    const user = await db.adminUser.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase(),
        passwordHash: await bcrypt.hash(data.password, 12),
        role: data.role
      },
      select: { id: true, email: true, name: true, role: true, active: true }
    });
    await writeAuditLog(db, request, "user.created", "AdminUser", user.id, { role: user.role });
    response.status(201).json(user);
  });

  router.patch("/users/:id", requireRole("ADMIN"), async (request, response) => {
    const data = parseBody(userUpdateSchema, request, response);
    if (!data) return;
    const target = await db.adminUser.findUnique({ where: { id: request.params.id } });
    if (!target) throw new HttpError(404, "User not found.");
    if (target.id === request.auth.userId && data.active === false) {
      throw new HttpError(409, "You cannot deactivate your own account.");
    }
    if (target.role === "ADMIN" && target.active && (data.active === false || data.role === "STAFF")) {
      const activeAdmins = await db.adminUser.count({ where: { active: true, role: "ADMIN" } });
      if (activeAdmins <= 1) throw new HttpError(409, "The last active administrator cannot be deactivated or changed to staff.");
    }
    const user = await db.adminUser.update({
      where: { id: target.id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.role ? { role: data.role } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.password ? { passwordHash: await bcrypt.hash(data.password, 12) } : {})
      },
      select: { id: true, email: true, name: true, role: true, active: true }
    });
    if (data.active === false || data.password) {
      await db.adminSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await writeAuditLog(db, request, "user.updated", "AdminUser", user.id, { fields: Object.keys(data) });
    response.json(user);
  });

  router.get("/audit", requireRole("ADMIN"), async (request, response) => {
    const logs = await db.auditLog.findMany({
      include: { actor: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    response.json(logs.map(({ actor, ...log }) => ({ ...log, actor: actor ? { email: actor.email, name: actor.name } : null })));
  });

  return router;
}
