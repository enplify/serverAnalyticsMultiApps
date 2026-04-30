import { FastifyReply } from "fastify";

export const SESSION_COOKIE_NAME = "docs_session";

type SessionCookieSameSite = "strict" | "lax" | "none";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getSessionCookieSecure(): boolean {
  /*
    Default bleibt absichtlich secure=true.
    Lokale HTTP-Entwicklung muss explizit SESSION_COOKIE_SECURE=false setzen.
  */
  return parseBoolean(process.env.SESSION_COOKIE_SECURE, true);
}

function getSessionCookieSameSite(): SessionCookieSameSite {
  const value = (process.env.SESSION_COOKIE_SAMESITE || "lax").trim().toLowerCase();

  if (value === "strict" || value === "lax" || value === "none") {
    return value;
  }

  throw new Error("SESSION_COOKIE_SAMESITE must be one of: strict, lax, none");
}

function formatSameSite(value: SessionCookieSameSite): "Strict" | "Lax" | "None" {
  if (value === "strict") return "Strict";
  if (value === "none") return "None";
  return "Lax";
}

export function getSessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: getSessionCookieSecure(),
    sameSite: getSessionCookieSameSite(),
    path: "/",
    maxAge
  } as const;
}

export function setNoStoreHeaders(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
  reply.header("Surrogate-Control", "no-store");
}

export function clearSessionCookie(reply: FastifyReply) {
  const secureAttribute = getSessionCookieSecure() ? "; Secure" : "";
  const sameSiteValues = Array.from(
    new Set<SessionCookieSameSite>([getSessionCookieSameSite(), "none", "lax"])
  );

  reply.header(
    "Set-Cookie",
    sameSiteValues.map(
      (sameSite) =>
        `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureAttribute}; SameSite=${formatSameSite(sameSite)}`
    )
  );
}
