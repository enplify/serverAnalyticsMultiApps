import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../../.env") });
dotenv.config({ path: resolve(__dirname, "../.env"), override: true });

type PortalSession = {
  curatorUserId: string;
  email: string;
  fullName: string;
  curatorGroupId: string;
};

type AuthenticatedRequest = FastifyRequest & {
  user: PortalSession;
};

const app = Fastify({ logger: true });

const SESSION_COOKIE_NAME =
  process.env.AUTH_COOKIE_NAME ||
  process.env.SESSION_COOKIE_NAME ||
  "docs_session";

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function getAllowedOrigins(): string[] {
  const raw =
    process.env.PROJECT1_CORS_ALLOWED_ORIGINS ||
    process.env.APP_BASE_URL ||
    "https://projekt1.qa.analytics.enplify.de";

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map(normalizeOrigin)
    )
  );
}

function verifySession(token: string): PortalSession | null {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  try {
    return jwt.verify(token, secret) as PortalSession;
  } catch {
    return null;
  }
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies?.[SESSION_COOKIE_NAME];

  if (!token) {
    reply.code(401);
    return { error: "Unauthorized" };
  }

  const session = verifySession(token);

  if (!session) {
    reply.code(401);
    return { error: "Unauthorized" };
  }

  (request as AuthenticatedRequest).user = session;
}

async function bootstrap() {
  const allowedOrigins = getAllowedOrigins();

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

  app.get("/api/health", async () => {
    return {
      status: "ok",
      service: "project1-api"
    };
  });

  app.get("/api/project1/me", { preHandler: requireAuth }, async (request) => {
    const user = (request as AuthenticatedRequest).user;

    return {
      status: "ok",
      app: "project1",
      user: {
        curatorUserId: user.curatorUserId,
        email: user.email,
        fullName: user.fullName,
        curatorGroupId: user.curatorGroupId
      }
    };
  });

  app.get("/api/project1/data", { preHandler: requireAuth }, async (request) => {
    const user = (request as AuthenticatedRequest).user;

    return {
      status: "ok",
      app: "project1",
      message: "Projekt 1 API ist authentifiziert erreichbar.",
      user: {
        email: user.email,
        fullName: user.fullName,
        curatorGroupId: user.curatorGroupId
      },
      data: {
        exampleMetric: 123,
        exampleStatus: "ready"
      }
    };
  });

  const port = Number(process.env.PROJECT1_API_PORT || 3111);

  await app.listen({
    host: "0.0.0.0",
    port
  });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
