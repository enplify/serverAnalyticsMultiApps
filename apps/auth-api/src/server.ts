import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../../.env") });
dotenv.config({ path: resolve(__dirname, "../.env"), override: true });

const app = Fastify({ logger: true });

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function parseAllowedOrigins(): string[] {
  const rawOrigins =
    process.env.CORS_ALLOWED_ORIGINS ||
    process.env.AUTH_ALLOWED_RETURN_TO_ORIGINS ||
    process.env.APP_BASE_URL ||
    "";

  const origins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

  if (origins.length > 0) {
    return Array.from(new Set(origins));
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CORS_ALLOWED_ORIGINS or AUTH_ALLOWED_RETURN_TO_ORIGINS must be set in production"
    );
  }

  return [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3100",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3100"
  ];
}

async function bootstrap() {
  const { authRoutes } = await import("./routes/auth");

  const allowedOrigins = parseAllowedOrigins();

  await app.register(cors, {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, allowedOrigins.includes(normalizeOrigin(origin)));
    },
    credentials: true
  });

  await app.register(cookie, {
    secret: process.env.SESSION_SECRET
  });

  await app.register(authRoutes, { prefix: "/api/auth" });

  const port = Number(process.env.AUTH_API_PORT || 3100);

  await app.listen({
    host: "0.0.0.0",
    port
  });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
