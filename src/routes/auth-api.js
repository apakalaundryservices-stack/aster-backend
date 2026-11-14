import { Router } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { HttpError, parseBody } from "../lib/errors.js";
import {
  clearCustomerSessionCookie,
  clearSessionCookie,
  createCustomerSession,
  createSession,
  readCookie,
  requireAuth,
  requireCustomerAuth,
  setCustomerSessionCookie,
  setSessionCookie,
  writeAuditLog
} from "../lib/security.js";

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200)
}).strict();
const changePasswordSchema = z.object({
  password: z.string().min(12).max(200)
}).strict();

export function createAuthApi(db, env = process.env) {
  const router = Router();
  const auth = requireAuth(db, env);
  const customerAuth = requireCustomerAuth(db, env);
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const redirectUri = env.GOOGLE_REDIRECT_URI || new URL("/api/auth/google/callback", env.APP_ORIGIN || "http://localhost:3000").toString();
  const googleClient = googleConfigured
    ? new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri)
    : null;
  const stateCookieName = env.GOOGLE_STATE_COOKIE_NAME || "aster_google_state";
  const bookingPage = "/booking.html";

  router.post("/login", async (request, response) => {
    const data = parseBody(loginSchema, request, response);
    if (!data) return;
    const email = data.email.toLowerCase();
    const user = await db.adminUser.findUnique({ where: { email } });
    if (!user || !user.active || !(await bcrypt.compare(data.password, user.passwordHash))) {
      throw new HttpError(401, "Email or password is incorrect.", "LOGIN_FAILED");
    }

    const session = await createSession(db, user.id, env);
    setSessionCookie(response, session.token, env);
    await writeAuditLog(db, { auth: { userId: user.id } }, "auth.login", "AdminUser", user.id, { role: user.role });
    response.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword },
      expiresAt: session.expiresAt
    });
  });

  router.post("/change-password", auth, async (request, response) => {
    const data = parseBody(changePasswordSchema, request, response);
    if (!data) return;
    const user = await db.adminUser.findUnique({ where: { id: request.auth.userId } });
    if (!user?.active) throw new HttpError(401, "Authentication required.");
    if (data.password.length < 12 || data.password.startsWith("replace-")) {
      throw new HttpError(400, "Choose a unique password of at least 12 characters.");
    }
    await db.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(data.password, 12), mustChangePassword: false }
    });
    await db.adminSession.updateMany({
      where: { userId: user.id, id: { not: request.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    await writeAuditLog(db, request, "auth.password_changed", "AdminUser", user.id);
    response.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: false } });
  });

  router.get("/me", auth, async (request, response) => {
    const user = await db.adminUser.findUnique({
      where: { id: request.auth.userId },
      select: { id: true, email: true, name: true, role: true, active: true, mustChangePassword: true }
    });
    if (!user?.active) throw new HttpError(401, "Authentication required.");
    response.json({ user });
  });

  router.post("/logout", auth, async (request, response) => {
    await db.adminSession.update({
      where: { id: request.sessionId },
      data: { revokedAt: new Date() }
    });
    await writeAuditLog(db, request, "auth.logout", "AdminUser", request.auth.userId);
    clearSessionCookie(response, env);
    response.status(204).end();
  });

  router.get("/google/status", (request, response) => {
    response.json({ configured: googleConfigured });
  });

  router.get("/google/start", (request, response) => {
    if (!googleClient) return response.redirect(303, `${bookingPage}?signin=setup`);

    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const secure = env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${stateCookieName}=${state}.${verifier}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`
    );
    response.redirect(302, googleClient.generateAuthUrl({
      access_type: "online",
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
      scope: ["openid", "email", "profile"],
      state
    }));
  });

  router.get("/google/callback", async (request, response) => {
    const storedState = readCookie(request, stateCookieName) || "";
    const [expectedState, verifier] = storedState.split(".");
    const returnedState = typeof request.query.state === "string" ? request.query.state : "";
    const stateMatches = expectedState && returnedState &&
      Buffer.byteLength(expectedState) === Buffer.byteLength(returnedState) &&
      timingSafeEqual(Buffer.from(expectedState), Buffer.from(returnedState));
    const secure = env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${stateCookieName}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
    );
    if (!stateMatches || !verifier || !googleClient) {
      return response.redirect(303, `${bookingPage}?signin=invalid`);
    }
    if (request.query.error || typeof request.query.code !== "string") {
      return response.redirect(303, `${bookingPage}?signin=cancelled`);
    }

    const { tokens } = await googleClient.getToken({
      code: request.query.code,
      codeVerifier: verifier
    });
    if (!tokens.id_token) throw new HttpError(401, "Google did not return a verified account.");

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID
    });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || profile.email_verified !== true) {
      throw new HttpError(401, "Use a Google account with a verified email address.");
    }

    const customer = await db.customer.upsert({
      where: { googleSubject: profile.sub },
      update: {
        email: profile.email.toLowerCase(),
        name: profile.name?.trim().slice(0, 120) || profile.email,
        picture: profile.picture?.startsWith("https://") ? profile.picture.slice(0, 1000) : null,
        lastLoginAt: new Date()
      },
      create: {
        googleSubject: profile.sub,
        email: profile.email.toLowerCase(),
        name: profile.name?.trim().slice(0, 120) || profile.email,
        picture: profile.picture?.startsWith("https://") ? profile.picture.slice(0, 1000) : null
      }
    });
    const session = await createCustomerSession(db, customer.id, env);
    setCustomerSessionCookie(response, session.token, env);
    response.redirect(303, `${bookingPage}?signin=success`);
  });

  router.get("/customer", customerAuth, async (request, response) => {
    response.json({
      user: {
        id: request.customer.id,
        email: request.customer.email,
        name: request.customer.name,
        picture: request.customer.picture
      }
    });
  });

  router.get("/customer/bookings", customerAuth, async (request, response) => {
    const bookings = await db.booking.findMany({
      where: { customerId: request.customer.id },
      include: { room: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    response.json(bookings.map((booking) => ({
      reference: booking.reference,
      room: booking.room.name,
      checkIn: booking.checkIn.toISOString().slice(0, 10),
      checkOut: booking.checkOut.toISOString().slice(0, 10),
      status: booking.status,
      totalAmount: booking.totalAmount,
      currency: booking.currency
    })));
  });

  router.post("/customer/logout", customerAuth, async (request, response) => {
    await db.customerSession.update({
      where: { id: request.customerSessionId },
      data: { revokedAt: new Date() }
    });
    clearCustomerSessionCookie(response, env);
    response.status(204).end();
  });

  return router;
}
