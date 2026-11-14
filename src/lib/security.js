import { createHmac, randomBytes } from "node:crypto";

const sessionDurationMs = 8 * 60 * 60 * 1000;
const customerSessionDurationMs = 30 * 24 * 60 * 60 * 1000;

function sessionCookieName(env) {
  return env.SESSION_COOKIE_NAME || "aster_session";
}

function customerSessionCookieName(env) {
  return env.CUSTOMER_SESSION_COOKIE_NAME || "aster_customer_session";
}

function hashToken(token, secret) {
  if (!secret || secret.startsWith("replace-") || secret.length < 32) {
    throw new Error("SESSION_SECRET must be a unique value with at least 32 characters.");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  const prefix = `${name}=`;
  const entry = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
}

export async function createSession(db, userId, env) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  const tokenHash = hashToken(token, env.SESSION_SECRET);
  await db.adminSession.create({ data: { tokenHash, userId, expiresAt } });
  return { token, expiresAt };
}

export function setSessionCookie(response, token, env) {
  const name = sessionCookieName(env);
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDurationMs / 1000}${secure}`
  );
}

export function clearSessionCookie(response, env) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName(env)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

export async function createCustomerSession(db, customerId, env) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + customerSessionDurationMs);
  const tokenHash = hashToken(token, env.SESSION_SECRET);
  await db.customerSession.create({ data: { tokenHash, customerId, expiresAt } });
  return { token, expiresAt };
}

export function setCustomerSessionCookie(response, token, env) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${customerSessionCookieName(env)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${customerSessionDurationMs / 1000}${secure}`
  );
}

export function clearCustomerSessionCookie(response, env) {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${customerSessionCookieName(env)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

export function optionalCustomerAuth(db, env) {
  return async (request, response, next) => {
    const token = readCookie(request, customerSessionCookieName(env));
    request.customer = null;
    if (!token) return next();

    const tokenHash = hashToken(token, env.SESSION_SECRET);
    const session = await db.customerSession.findUnique({
      where: { tokenHash },
      include: { customer: true }
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return next();

    request.customer = {
      id: session.customer.id,
      email: session.customer.email,
      name: session.customer.name,
      picture: session.customer.picture
    };
    request.customerSessionId = session.id;
    return next();
  };
}

export function requireCustomerAuth(db, env) {
  const optionalAuth = optionalCustomerAuth(db, env);
  return async (request, response, next) => {
    await optionalAuth(request, response, (error) => {
      if (error) return next(error);
      if (!request.customer) return response.status(401).json({ error: "Sign in to your guest account to continue." });
      return next();
    });
  };
}

export function requireAuth(db, env) {
  return async (request, response, next) => {
    const token = readCookie(request, sessionCookieName(env));
    if (!token) return response.status(401).json({ error: "Authentication required." });

    const tokenHash = hashToken(token, env.SESSION_SECRET);
    const session = await db.adminSession.findUnique({
      where: { tokenHash },
      include: { user: true }
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active) {
      return response.status(401).json({ error: "Session is invalid or expired." });
    }

    request.auth = {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      mustChangePassword: session.user.mustChangePassword
    };
    request.sessionId = session.id;
    return next();
  };
}

export function requirePasswordChangeComplete(request, response, next) {
  if (request.auth?.mustChangePassword) {
    return response.status(403).json({ error: "Change your password before using the management dashboard.", code: "PASSWORD_CHANGE_REQUIRED" });
  }
  return next();
}

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.auth || !roles.includes(request.auth.role)) {
      return response.status(403).json({ error: "You do not have permission to perform this action." });
    }
    return next();
  };
}

export async function writeAuditLog(db, request, action, entity, entityId, details = undefined) {
  await db.auditLog.create({
    data: {
      actorId: request.auth?.userId || null,
      action,
      entity,
      entityId: entityId || null,
      details
    }
  });
}
