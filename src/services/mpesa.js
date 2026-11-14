import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "../lib/errors.js";

const sandboxOrigin = "https://sandbox.safaricom.co.ke";

function assertSandboxConfiguration(env) {
  if (env.MPESA_MODE !== "sandbox") {
    throw new HttpError(503, "M-Pesa is disabled unless MPESA_MODE is explicitly set to sandbox.", "MPESA_DISABLED");
  }
  for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY"]) {
    if (!env[key] || env[key].startsWith("replace-")) {
      throw new HttpError(503, `M-Pesa sandbox configuration is missing ${key}.`, "MPESA_NOT_CONFIGURED");
    }
  }
}

function nairobiTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}${value.hour}${value.minute}${value.second}`;
}

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.errorMessage || result.errorDescription || `Safaricom sandbox returned HTTP ${response.status}.`);
    error.providerCode = result.errorCode || String(response.status);
    throw error;
  }
  return result;
}

export async function getAccessToken(env) {
  assertSandboxConfiguration(env);
  const authorization = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString("base64");
  const url = new URL("/oauth/v1/generate", sandboxOrigin);
  url.searchParams.set("grant_type", "client_credentials");
  const response = await fetch(url, {
    headers: { authorization: `Basic ${authorization}` },
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(`Safaricom sandbox token request failed with HTTP ${response.status}.`);
  }
  return result.access_token;
}

export async function initiateStkPush(env, { phone, amount, reference, callbackUrl }) {
  assertSandboxConfiguration(env);
  if (!env.MPESA_CALLBACK_TOKEN || env.MPESA_CALLBACK_TOKEN.startsWith("replace-")) {
    throw new HttpError(503, "Set MPESA_CALLBACK_TOKEN before starting sandbox payments.", "MPESA_NOT_CONFIGURED");
  }
  const callback = new URL(callbackUrl);
  if (callback.protocol !== "https:") {
    throw new HttpError(503, "The M-Pesa callback URL must use HTTPS.", "MPESA_CALLBACK_URL_INVALID");
  }
  const timestamp = nairobiTimestamp();
  const password = Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString("base64");
  const token = await getAccessToken(env);
  return postJson(`${sandboxOrigin}/mpesa/stkpush/v1/processrequest`, {
    BusinessShortCode: env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: env.MPESA_SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: callback.toString(),
    AccountReference: reference.slice(0, 12),
    TransactionDesc: `Aster booking ${reference}`.slice(0, 30)
  }, { authorization: `Bearer ${token}` });
}

export async function queryStkPush(env, checkoutRequestId) {
  assertSandboxConfiguration(env);
  const timestamp = nairobiTimestamp();
  const password = Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString("base64");
  const token = await getAccessToken(env);
  return postJson(`${sandboxOrigin}/mpesa/stkpushquery/v1/query`, {
    BusinessShortCode: env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId
  }, { authorization: `Bearer ${token}` });
}

export function callbackTokenMatches(received, expected) {
  if (!received || !expected || expected.startsWith("replace-")) return false;
  const actualBytes = Buffer.from(String(received));
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function callbackFingerprint(callback) {
  return createHash("sha256").update(JSON.stringify(callback)).digest("hex");
}
