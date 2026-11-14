import { HttpError } from "../lib/errors.js";

const paymentModes = ["CASH_ONLY", "MPESA", "BOTH"];

export async function getPaymentMode(db, env = process.env) {
  const setting = await db.systemSetting.findUnique({ where: { key: "paymentMode" } });
  const value = setting?.value || env.PAYMENT_MODE || "BOTH";
  if (!paymentModes.includes(value)) throw new HttpError(500, "The configured payment mode is invalid.", "INVALID_PAYMENT_MODE");
  return value;
}

export function paymentMethodAllowed(mode, method) {
  return mode === "BOTH" || (mode === "CASH_ONLY" && method === "CASH") || (mode === "MPESA" && method === "MPESA");
}
