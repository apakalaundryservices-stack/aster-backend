import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}
if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
  throw new Error("Set DATABASE_URL to a PostgreSQL connection string in .env.");
}
if (!sessionSecret || sessionSecret.startsWith("replace-") || sessionSecret.length < 32) {
  throw new Error("Set SESSION_SECRET to a unique secret of at least 32 characters in .env.");
}
if (process.env.MPESA_MODE && process.env.MPESA_MODE !== "sandbox") {
  throw new Error("This local system only supports MPESA_MODE=sandbox.");
}

const app = createApp();

app.listen(port, () => {
  console.log(`Aster Suites local server listening at http://localhost:${port}`);
});
