import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import dotenv from "dotenv";
import { meRoutes } from "./routes/me";
import { documentRoutes } from "./routes/documents";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";

dotenv.config();

const app = Fastify({ logger: true });
 
function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function parseAllowedOrigins(): string[] {
  const rawOrigins = process.env.CORS_ALLOWED_ORIGINS || process.env.APP_BASE_URL || "";

  const origins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

  if (origins.length > 0) {
    return Array.from(new Set(origins));
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("CORS_ALLOWED_ORIGINS or APP_BASE_URL must be set in production");
  }

  return ["http://localhost:3000", "http://localhost:3001"];
}
 
async function bootstrap() {
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

  await app.register(multipart, {
    limits: {
      fileSize: 200 * 1024 * 1024
    }
  });

  await app.register(healthRoutes, { prefix: "/api/health" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(meRoutes, { prefix: "/api/me" });
  await app.register(documentRoutes, { prefix: "/api/documents" });

  const port = Number(process.env.API_PORT || 3001);

  await app.listen({
    host: "0.0.0.0",
    port
  });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
