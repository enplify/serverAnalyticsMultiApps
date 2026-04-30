import { FastifyInstance, FastifyReply } from "fastify";
import { getCuratorUserByToken, getGroupsForCuratorUser } from "../services/curator";
import { getTenantMappingByCuratorGroupId } from "../services/tenant-mapping";
import { SESSION_TTL_SECONDS, signSession } from "../services/session";
import {
  clearSessionCookie,
  getSessionCookieOptions,
  setNoStoreHeaders,
  SESSION_COOKIE_NAME
} from "../config/security";

const DOCUMENT_ENTRY_VALIDATION_COOKIE_NAME = "docs_entry_validated";
const AUTH_RETURN_TO_COOKIE_NAME = "docs_auth_return_to";
const DEFAULT_DOCUMENT_ENTRY_VALIDATION_TTL_SECONDS = 15;
const AUTH_RETURN_TO_TTL_SECONDS = 300;

function getDocumentEntryValidationTtlSeconds(): number {
  const rawValue = process.env.DOCUMENT_ENTRY_VALIDATION_TTL_SECONDS;
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : NaN;

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return DEFAULT_DOCUMENT_ENTRY_VALIDATION_TTL_SECONDS;
  }

  return Math.min(parsedValue, 60);
}

function getDefaultReturnTo(): string {
  return process.env.APP_BASE_URL || "/documents";
}

function sanitizeReturnTo(rawReturnTo: string | undefined): string {
  const fallback = getDefaultReturnTo();

  if (!rawReturnTo) {
    return fallback;
  }

  if (rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")) {
    return rawReturnTo;
  }

  try {
    const parsedReturnTo = new URL(rawReturnTo);
    const parsedFallback = new URL(fallback);

    if (parsedReturnTo.origin === parsedFallback.origin) {
      return rawReturnTo;
    }
  } catch {
    // Invalid or relative non-path URL. Fall back below.
  }

  return fallback;
}

function setAuthReturnToCookie(reply: FastifyReply, returnTo: string) {
  reply.setCookie(
    AUTH_RETURN_TO_COOKIE_NAME,
    returnTo,
    getSessionCookieOptions(AUTH_RETURN_TO_TTL_SECONDS)
  );
}

function clearNamedCookie(reply: FastifyReply, cookieName: string) {
  for (const sameSite of ["lax", "none"] as const) {
    reply.setCookie(cookieName, "", {
      ...getSessionCookieOptions(0),
      sameSite,
      maxAge: 0,
      expires: new Date(0)
    });
  }
}

function clearDocumentEntryValidationCookie(reply: FastifyReply) {
  clearNamedCookie(reply, DOCUMENT_ENTRY_VALIDATION_COOKIE_NAME);
}

function clearAuthReturnToCookie(reply: FastifyReply) {
  clearNamedCookie(reply, AUTH_RETURN_TO_COOKIE_NAME);
}

function extractTokenFromPayload(rawPayload: string): string | null {
  const candidates = [rawPayload];

  try {
    candidates.push(decodeURIComponent(rawPayload));
  } catch {
    // ignore invalid URI encoding
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (parsed.token) return String(parsed.token);
      if (parsed.auth_token) return String(parsed.auth_token);

      return null;
    } catch {
      // try next candidate
    }
  }

  return null;
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/curator/start", async (request, reply) => {
    setNoStoreHeaders(reply);
    clearSessionCookie(reply);
    clearDocumentEntryValidationCookie(reply);

    const query = request.query as { returnTo?: string };
    const returnTo = sanitizeReturnTo(query.returnTo);

    const curatorBaseUrl = process.env.CURATOR_BASE_URL;
    const callbackUrl = process.env.CURATOR_CALLBACK_URL;

    if (!curatorBaseUrl || !callbackUrl) {
      reply.code(500);
      return { error: "Curator auth configuration missing" };
    }

    const redirectUrl = `${curatorBaseUrl}/fetchUser?redirect_url=${encodeURIComponent(callbackUrl)}`;

    setAuthReturnToCookie(reply, returnTo);

    return reply.redirect(redirectUrl);
  });

  app.get("/curator/callback", async (request, reply) => {
    setNoStoreHeaders(reply);

    const query = request.query as { payload?: string; token?: string };

    let token = query.token ? String(query.token) : null;

    if (!token && query.payload) {
      token = extractTokenFromPayload(String(query.payload));
    }

    if (!token) {
      reply.code(400);
      return { error: "Missing Curator token" };
    }

    const user = await getCuratorUserByToken(token);
    const groups = await getGroupsForCuratorUser(user.id);

    request.log.info(
      {
        curatorUserId: user.id,
        email: user.email,
        fullName: user.full_name,
        groups: groups.map((group) => ({
          id: group.frontend_group_id,
          name: group.name
        }))
      },
      "Curator user resolved"
    );

    if (groups.length === 0) {
      reply.code(403);
      return { error: "Curator user has no Curator groups" };
    }

    const mappedGroup = await (async () => {
      for (const group of groups) {
        const mapping = await getTenantMappingByCuratorGroupId(
          String(group.frontend_group_id)
        );

        if (mapping) {
          return { group, mapping };
        }
      }

      return null;
    })();

    if (!mappedGroup) {
      reply.code(403);
      return { error: "No tenant mapping for Curator user groups" };
    }

    request.log.info(
      {
        mappedGroupId: mappedGroup.group.frontend_group_id,
        mappedGroupName: mappedGroup.group.name,
        tenantKey: mappedGroup.mapping.tenant_key
      },
      "Curator group mapped to tenant"
    );

    const sessionToken = signSession({
      curatorUserId: user.id,
      email: user.email,
      fullName: user.full_name,
      curatorGroupId: String(mappedGroup.group.frontend_group_id)
    });

    const returnTo = sanitizeReturnTo(
      request.cookies?.[AUTH_RETURN_TO_COOKIE_NAME] || process.env.APP_BASE_URL
    );

    reply.setCookie(
      SESSION_COOKIE_NAME,
      sessionToken,
      getSessionCookieOptions(SESSION_TTL_SECONDS)
    );

    reply.setCookie(
      DOCUMENT_ENTRY_VALIDATION_COOKIE_NAME,
      "1",
      getSessionCookieOptions(getDocumentEntryValidationTtlSeconds())
    );

    clearAuthReturnToCookie(reply);

    return reply.redirect(returnTo);
  });

  app.get("/logout", async (_request, reply) => {
    setNoStoreHeaders(reply);
    clearSessionCookie(reply);
    clearDocumentEntryValidationCookie(reply);
    clearAuthReturnToCookie(reply);

    const curatorLogoutUrl =
      process.env.CURATOR_LOGOUT_URL || "https://qa.analytics.enplify.de/user/logout";

    return reply.redirect(curatorLogoutUrl);
  });

  app.post("/logout", async (_request, reply) => {
    setNoStoreHeaders(reply);
    clearSessionCookie(reply);
    clearDocumentEntryValidationCookie(reply);
    clearAuthReturnToCookie(reply);

    const curatorLogoutUrl =
      process.env.CURATOR_LOGOUT_URL || "https://qa.analytics.enplify.de/user/logout";

    return {
      result: "ok",
      redirectUrl: curatorLogoutUrl
    };
  });

  app.get("/local-logout", async (_request, reply) => {
    setNoStoreHeaders(reply);
    clearSessionCookie(reply);
    clearDocumentEntryValidationCookie(reply);
    clearAuthReturnToCookie(reply);

    return {
      result: "ok",
      message: "Local document session cleared"
    };
  });
}
