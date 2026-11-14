import { Router } from "express";
import { z } from "zod";
import { HttpError, parseBody } from "../lib/errors.js";
import { normalizeKenyanPhone } from "../services/bookings.js";
import { getPaymentMode, paymentMethodAllowed } from "../services/settings.js";
import { callbackFingerprint, callbackTokenMatches, initiateStkPush, queryStkPush } from "../services/mpesa.js";

const stkSchema = z.object({
  reference: z.string().trim().min(1).max(20),
  phone: z.string().trim().min(1).max(40)
}).strict();

function callbackValue(items, name) {
  const item = Array.isArray(items) ? items.find((entry) => entry?.Name === name) : null;
  return item?.Value;
}

function callbackUrl(env) {
  if (!env.MPESA_CALLBACK_BASE_URL || env.MPESA_CALLBACK_BASE_URL.startsWith("replace-")) {
    throw new HttpError(503, "Set MPESA_CALLBACK_BASE_URL to an HTTPS callback URL before starting sandbox payments.", "MPESA_NOT_CONFIGURED");
  }
  const url = new URL("/api/payments/mpesa/callback", env.MPESA_CALLBACK_BASE_URL);
  if (url.protocol !== "https:") {
    throw new HttpError(503, "The M-Pesa callback URL must use HTTPS.", "MPESA_CALLBACK_URL_INVALID");
  }
  url.searchParams.set("token", env.MPESA_CALLBACK_TOKEN || "");
  return url.toString();
}

export function createPaymentsApi(db, env = process.env) {
  const router = Router();

  router.post("/mpesa/stk-push", async (request, response) => {
    const data = parseBody(stkSchema, request, response);
    if (!data) return;
    const mode = await getPaymentMode(db, env);
    if (!paymentMethodAllowed(mode, "MPESA")) {
      throw new HttpError(409, `M-Pesa payments are disabled in ${mode} mode.`);
    }

    const phone = normalizeKenyanPhone(data.phone);
    const booking = await db.booking.findFirst({
      where: {
        reference: data.reference.toUpperCase(),
        phone,
        status: "PENDING",
        holdExpiresAt: { gt: new Date() }
      },
      include: { payments: { where: { method: "MPESA" }, orderBy: { createdAt: "desc" }, take: 1 } }
    });
    if (!booking) throw new HttpError(404, "An active M-Pesa booking matching those details was not found.");

    let payment = booking.payments[0];
    if (!payment || payment.status !== "PENDING") {
      payment = await db.payment.create({
        data: {
          bookingId: booking.id,
          method: "MPESA",
          status: "PENDING",
          amount: booking.totalAmount,
          phone
        }
      });
    } else if (payment.checkoutRequestId) {
      throw new HttpError(409, "A payment request is already in progress. Check the phone prompt or wait for its result.");
    }

    let providerResult;
    try {
      providerResult = await initiateStkPush(env, {
        phone,
        amount: booking.totalAmount,
        reference: booking.reference,
        callbackUrl: callbackUrl(env)
      });
    } catch (error) {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          resultDescription: "Sandbox request could not be completed."
        }
      });
      if (error instanceof HttpError) throw error;
      console.warn("M-Pesa sandbox request failed.", { code: error.providerCode || error.name });
      throw new HttpError(502, "M-Pesa sandbox request failed. Check the local configuration and try again.", "MPESA_REQUEST_FAILED");
    }

    if (String(providerResult.ResponseCode) !== "0" || !providerResult.CheckoutRequestID) {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          resultCode: String(providerResult.ResponseCode || "REJECTED"),
          resultDescription: String(providerResult.ResponseDescription || providerResult.CustomerMessage || "Sandbox rejected the request.").slice(0, 500)
        }
      });
      throw new HttpError(502, "M-Pesa sandbox did not accept the payment request.", "MPESA_REQUEST_REJECTED");
    }

    await db.payment.update({
      where: { id: payment.id },
      data: {
        checkoutRequestId: providerResult.CheckoutRequestID,
        merchantRequestId: providerResult.MerchantRequestID || null,
        resultDescription: String(providerResult.CustomerMessage || "Payment prompt sent.").slice(0, 500)
      }
    });
    response.status(202).json({
      reference: booking.reference,
      message: String(providerResult.CustomerMessage || "Check the phone for the sandbox payment prompt."),
      status: "PENDING"
    });
  });

  router.post("/mpesa/callback", async (request, response) => {
    if (!callbackTokenMatches(request.query.token, env.MPESA_CALLBACK_TOKEN)) {
      throw new HttpError(403, "Callback authentication failed.");
    }
    const callback = request.body?.Body?.stkCallback;
    if (
      !callback ||
      typeof callback.CheckoutRequestID !== "string" ||
      callback.ResultCode === undefined
    ) {
      throw new HttpError(400, "The M-Pesa callback payload is invalid.");
    }

    const fingerprint = callbackFingerprint(callback);
    const resultCode = Number(callback.ResultCode);
    const description = String(callback.ResultDesc || "M-Pesa callback received.").slice(0, 500);

    await db.$transaction(async (tx) => {
      const current = await tx.payment.findUnique({
        where: { checkoutRequestId: callback.CheckoutRequestID }
      });
      if (!current) throw new HttpError(404, "Payment request was not found.");
      await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${current.id} FOR UPDATE`;
      const payment = await tx.payment.findUnique({ where: { id: current.id } });
      if (payment.callbackFingerprint === fingerprint) return;
      if (payment.status !== "PENDING") return;

      if (resultCode !== 0) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "FAILED", resultCode: String(callback.ResultCode).slice(0, 40), resultDescription: description, callbackFingerprint: fingerprint }
        });
        return;
      }

      const items = callbackValue(callback.CallbackMetadata?.Item ? callback.CallbackMetadata.Item : [], "Amount");
      const receipt = callbackValue(callback.CallbackMetadata?.Item ? callback.CallbackMetadata.Item : [], "MpesaReceiptNumber");
      const callbackPhoneValue = callbackValue(callback.CallbackMetadata?.Item ? callback.CallbackMetadata.Item : [], "PhoneNumber");
      const callbackPhone = callbackPhoneValue === undefined ? null : normalizeKenyanPhone(String(callbackPhoneValue));
      const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } });
      const valuesMatch = Number(items) === payment.amount && callbackPhone === payment.phone && typeof receipt === "string" && receipt.length > 0;

      if (!booking || !valuesMatch) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "FAILED",
            resultCode: String(callback.ResultCode).slice(0, 40),
            resultDescription: "Callback details did not match the payment; staff review is required.",
            callbackFingerprint: fingerprint
          }
        });
        return;
      }

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
      const canConfirm = booking.status === "PENDING" && competing < room.inventory;

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCESS",
          resultCode: String(callback.ResultCode).slice(0, 40),
          resultDescription: canConfirm ? description : "Payment received after the room hold changed; staff review is required.",
          mpesaReceiptNumber: String(receipt).slice(0, 40),
          callbackFingerprint: fingerprint
        }
      });
      if (canConfirm) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: "CONFIRMED", holdExpiresAt: null }
        });
      } else if (booking.status === "PENDING") {
        await tx.booking.update({ where: { id: booking.id }, data: { status: "REJECTED", holdExpiresAt: null } });
      }
    }, { isolationLevel: "Serializable" });

    response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  });

  return router;
}

export async function queryPaymentStatus(db, env, paymentId) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { booking: { select: { reference: true } } }
  });
  if (!payment) throw new HttpError(404, "Payment not found.");
  if (payment.method !== "MPESA" || !payment.checkoutRequestId) {
    throw new HttpError(409, "This payment has no M-Pesa sandbox request to query.");
  }
  const result = await queryStkPush(env, payment.checkoutRequestId);
  return {
    reference: payment.booking.reference,
    status: payment.status,
    resultCode: String(result.ResultCode ?? ""),
    resultDescription: String(result.ResultDesc || "Query completed.").slice(0, 500)
  };
}
