import { FastifyReply } from "fastify";

export const SESSION_COOKIE_NAME =
  process.env.AUTH_COOKIE_NAME ||
  process.env.SESSION_COOKIE_NAME ||
  "docs_session";

export const DOCUMENT_ENTRY_VALIDATION_COOKIE_NAME = "docs_entry_validated";
export const AUTH_RETURN_TO_COOKIE_NAME = "docs_auth_return_to";

type SessionCookieSameSite = "strict" | "lax" | "none";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getSessionCookieSecure(): boolean {
  return parseBoolean(process.env.SESSION_COOKIE_SECURE, true);
}

function getSessionCookieSameSite(): SessionCookieSameSite {
  const value = (process.env.SESSION_COOKIE_SAMESITE || "lax").trim().toLowerCase();

  if (value === "strict" || value === "lax" || value === "none") {
    return value;
  }

  throw new Error("SESSION_COOKIE_SAMESITE must be one of: strict, lax, none");
}

function getSessionCookieDomain(): string | undefined {
  const value = process.env.AUTH_COOKIE_DOMAIN?.trim();

  if (!value) {
    return undefined;
  }

  return value;
}

function formatSameSite(value: SessionCookieSameSite): "Strict" | "Lax" | "None" {
  if (value === "strict") return "Strict";
  if (value === "none") return "None";
  return "Lax";
}

export function getSessionCookieOptions(maxAge: number) {
  const domain = getSessionCookieDomain();

  return {
    httpOnly: true,
    secure: getSessionCookieSecure(),
    sameSite: getSessionCookieSameSite(),
    domain,
    path: "/",
    maxAge
  } as const;
}

export function getDocumentEntryValidationTtlSeconds(): number {
  const rawValue =
    process.env.DOCUMENT_ENTRY_VALIDATION_TTL_SECONDS ||
    process.env.ENTRY_VALIDATION_TTL_SECONDS ||
    "15";

  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15;
  }

  return Math.floor(parsed);
}

export function setNoStoreHeaders(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
  reply.header("Surrogate-Control", "no-store");
}

export function clearNamedCookie(reply: FastifyReply, cookieName: string) {
  const secureAttribute = getSessionCookieSecure() ? "; Secure" : "";
  const configuredDomain = getSessionCookieDomain();

  const sameSiteValues = Array.from(
    new Set<SessionCookieSameSite>([getSessionCookieSameSite(), "none", "lax"])
  );

  const domains = configuredDomain ? [configuredDomain, undefined] : [undefined];

  const headers: string[] = [];

  for (const domain of domains) {
    const domainAttribute = domain ? `; Domain=${domain}` : "";

    for (const sameSite of sameSiteValues) {
      headers.push(
        `${cookieName}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly${secureAttribute}${domainAttribute}; SameSite=${formatSameSite(sameSite)}`
      );
    }
  }

  const existing = reply.getHeader("Set-Cookie");

  if (Array.isArray(existing)) {
    reply.header("Set-Cookie", [...existing.map(String), ...headers]);
    return;
  }

  if (existing) {
    reply.header("Set-Cookie", [String(existing), ...headers]);
    return;
  }

  reply.header("Set-Cookie", headers);
}

export function clearSessionCookie(reply: FastifyReply) {
  clearNamedCookie(reply, SESSION_COOKIE_NAME);
}

export function clearDocumentEntryValidationCookie(reply: FastifyReply) {
  clearNamedCookie(reply, DOCUMENT_ENTRY_VALIDATION_COOKIE_NAME);
}

export function clearAuthReturnToCookie(reply: FastifyReply) {
  clearNamedCookie(reply, AUTH_RETURN_TO_COOKIE_NAME);
}

export const clearDocsSession = clearSessionCookie;
export const clearDocsAuthReturnToCookie = clearAuthReturnToCookie;
