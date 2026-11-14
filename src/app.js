import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { prisma } from "./db.js";
import { HttpError } from "./lib/errors.js";
import { requireAuth, requirePasswordChangeComplete } from "./lib/security.js";
import { createAdminApi } from "./routes/admin-api.js";
import { createAuthApi } from "./routes/auth-api.js";
import { createPaymentsApi } from "./routes/payments-api.js";
import { createPublicApi } from "./routes/public-api.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function isPrismaError(error, code) {
  return error?.code === code;
}

export function createApp(options = {}) {
  const db = options.db || prisma;
  const env = options.env || process.env;
  const app = express();
  const appOrigin = env.APP_ORIGIN || "http://localhost:3000";
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again later." }
  });
  const publicWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Try again later." }
  });

  app.use((request, response, next) => {
    request.requestId = randomUUID();
    response.setHeader("X-Request-Id", request.requestId);
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        frameAncestors: ["'self'"],
        frameSrc: ["https://www.google.com"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"]
      }
    }
  }));
  app.use(cors({ origin: appOrigin, credentials: true }));
  app.use((request, response, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.get("origin");
      if (origin && origin !== appOrigin) {
        return response.status(403).json({ error: "Request origin is not allowed." });
      }
    }
    next();
  });
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (request, response) => {
    response.type("text/plain").status(200).send("OK");
  });
  app.get("/api/health", (request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get("/api/ready", async (request, response) => {
    await db.$queryRaw`SELECT 1`;
    response.json({ status: "ready", database: "ok" });
  });

  app.use("/api/auth/login", loginLimiter);
  app.use("/api/auth/google/start", loginLimiter);
  app.use("/api/auth", createAuthApi(db, env));
  app.use("/api/admin", requireAuth(db, env), requirePasswordChangeComplete, createAdminApi(db, env));
  app.use("/api/payments/mpesa/stk-push", publicWriteLimiter);
  app.use("/api/payments", createPaymentsApi(db, env));
  app.use("/api/bookings", publicWriteLimiter);
  app.use("/api/meal-orders", publicWriteLimiter);
  app.use("/api/service-requests", publicWriteLimiter);
  app.use("/api/contact-messages", publicWriteLimiter);
  app.use("/api", createPublicApi(db, env));

  const adminRoot = path.join(projectRoot, "admin");
  app.get("/admin", (request, response) => response.sendFile(path.join(adminRoot, "index.html")));
  app.use("/admin", express.static(adminRoot));
  app.use(express.static(path.join(projectRoot, "public")));

  app.use("/api", (request, response) => response.status(404).json({ error: "API endpoint not found." }));
  app.use((request, response) => response.status(404).type("text/plain").send("Not found."));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error instanceof HttpError
      ? error.status
      : isPrismaError(error, "P2002")
        ? 409
        : isPrismaError(error, "P2025")
          ? 404
          : isPrismaError(error, "P2034")
            ? 409
            : 500;
    const message = error instanceof HttpError
      ? error.message
      : status === 409
        ? "The request conflicts with current data. Refresh and try again."
        : status === 404
          ? "The requested record was not found."
          : "An unexpected server error occurred.";
    console.error("Request failed.", {
      requestId: request.requestId,
      status,
      code: error.code || error.name || "ERROR"
    });
    response.status(status).json({
      error: message,
      requestId: request.requestId
    });
  });

  return app;
}

