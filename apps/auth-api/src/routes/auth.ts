import { FastifyInstance, FastifyReply } from "fastify";
import { getCuratorUserByToken, getGroupsForCuratorUser } from "../services/curator";
import { getTenantMappingByCuratorGroupId } from "../services/tenant-mapping";
import { SESSION_TTL_SECONDS, signSession } from "../services/session";
import {
  clearNamedCookie,
  clearSessionCookie,
  getDocumentEntryValidationTtlSeconds,
  getSessionCookieOptions,
  setNoStoreHeaders,
  SESSION_COOKIE_NAME
} from "../config/security";

const AUTH_RETURN_TO_COOKIE_NAME = "docs_auth_return_to";
const AUTH_APP_COOKIE_NAME = "portal_auth_app";

type AppConfig = {
  appKey: string;
  baseUrl: string;
  entryValidationCookieName: string;
};

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

function getAllowedApps(): Set<string> {
  const raw = process.env.AUTH_ALLOWED_APPS || "documents,project1,project2";

  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function getDefaultAppBaseUrl(appKey: string): string | null {
  if (appKey === "documents") {
    return "https://dokumente.qa.analytics.enplify.de/documents";
  }

  if (appKey === "project1") {
    return "https://projekt1.qa.analytics.enplify.de";
  }

  if (appKey === "project2") {
    return "https://projekt2.qa.analytics.enplify.de";
  }

  return null;
}

function getAppBaseUrl(appKey: string): string | null {
  const envKey = `AUTH_APP_${appKey.toUpperCase()}_BASE_URL`;
  const configuredValue = process.env[envKey]?.trim();

  if (configuredValue) {
    return configuredValue.replace(/\/+$/, "");
  }

  return getDefaultAppBaseUrl(appKey);
}

function getEntryValidationCookieName(appKey: string): string {
  if (appKey === "documents") {
    return "docs_entry_validated";
  }

  return `${appKey}_entry_validated`;
}

function resolveAppConfig(rawApp: unknown): AppConfig | null {
  const appKey = typeof rawApp === "string" ? rawApp.trim() : "";

  if (!appKey) {
    return null;
  }

  if (!getAllowedApps().has(appKey)) {
    return null;
  }

  const baseUrl = getAppBaseUrl(appKey);

  if (!baseUrl) {
    return null;
  }

  return {
    appKey,
    baseUrl,
    entryValidationCookieName: getEntryValidationCookieName(appKey)
  };
}

function sanitizeReturnToForApp(rawReturnTo: unknown, appConfig: AppConfig): string {
  if (typeof rawReturnTo !== "string" || !rawReturnTo.trim()) {
    return appConfig.baseUrl;
  }

  const candidate = rawReturnTo.trim();

  try {
    const appBase = new URL(appConfig.baseUrl);

    if (candidate.startsWith("/") && !candidate.startsWith("//")) {
      return new URL(candidate, appBase.origin).toString();
    }

    const returnUrl = new URL(candidate);

    if (returnUrl.origin !== appBase.origin) {
      return appConfig.baseUrl;
    }

    return returnUrl.toString();
  } catch {
    return appConfig.baseUrl;
  }
}

function encodeCookieValue(value: string): string {
  return encodeURIComponent(value);
}

function decodeCookieValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function setShortLivedCookie(reply: FastifyReply, name: string, value: string, maxAge: number) {
  reply.setCookie(name, value, getSessionCookieOptions(maxAge));
}

function clearAuthFlowCookies(reply: FastifyReply) {
  clearNamedCookie(reply, AUTH_RETURN_TO_COOKIE_NAME);
  clearNamedCookie(reply, AUTH_APP_COOKIE_NAME);
}

function clearEntryValidationCookies(reply: FastifyReply) {
  const cookieNames = new Set<string>([
    "docs_entry_validated",
    "project1_entry_validated",
    "project2_entry_validated"
  ]);

  for (const appKey of getAllowedApps()) {
    cookieNames.add(getEntryValidationCookieName(appKey));
  }

  for (const cookieName of cookieNames) {
    clearNamedCookie(reply, cookieName);
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.get("/curator/start", async (request, reply) => {
    setNoStoreHeaders(reply);

    const query = request.query as { returnTo?: string; app?: string };

    const appConfig = resolveAppConfig(query.app);

    if (!appConfig) {
      reply.code(400);
      return {
        error: "Invalid app",
        message:
          "Missing or unsupported app. Provide a valid app query parameter, for example app=documents or app=project1."
      };
    }

    const returnTo = sanitizeReturnToForApp(query.returnTo, appConfig);

    clearNamedCookie(reply, SESSION_COOKIE_NAME);
    clearNamedCookie(reply, appConfig.entryValidationCookieName);
    clearNamedCookie(reply, AUTH_RETURN_TO_COOKIE_NAME);
    clearNamedCookie(reply, AUTH_APP_COOKIE_NAME);

    setShortLivedCookie(reply, AUTH_APP_COOKIE_NAME, appConfig.appKey, 300);
    setShortLivedCookie(reply, AUTH_RETURN_TO_COOKIE_NAME, returnTo, 300);

    const curatorBaseUrl = process.env.CURATOR_BASE_URL;
    const callbackUrl = process.env.CURATOR_CALLBACK_URL;

    if (!curatorBaseUrl || !callbackUrl) {
      reply.code(500);
      return { error: "Curator auth configuration missing" };
    }

    const redirectUrl =
      `${curatorBaseUrl.replace(/\/+$/, "")}/fetchUser?redirect_url=${encodeURIComponent(callbackUrl)}`;

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

    const appConfig = resolveAppConfig(request.cookies?.[AUTH_APP_COOKIE_NAME]);

    if (!appConfig) {
      reply.code(400);
      return {
        error: "Missing auth app context",
        message:
          "The auth flow has no valid app context. Start authentication again from the target application."
      };
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
        tenantKey: mappedGroup.mapping.tenant_key,
        appKey: appConfig.appKey
      },
      "Curator group mapped to tenant"
    );

    const sessionToken = signSession({
      curatorUserId: user.id,
      email: user.email,
      fullName: user.full_name,
      curatorGroupId: String(mappedGroup.group.frontend_group_id)
    });

    const cookieReturnTo = decodeCookieValue(
      request.cookies?.[AUTH_RETURN_TO_COOKIE_NAME]
    );

    const returnTo = sanitizeReturnToForApp(cookieReturnTo, appConfig);

    reply.setCookie(
      SESSION_COOKIE_NAME,
      sessionToken,
      getSessionCookieOptions(SESSION_TTL_SECONDS)
    );

    reply.setCookie(
      appConfig.entryValidationCookieName,
      "1",
      getSessionCookieOptions(getDocumentEntryValidationTtlSeconds())
    );

    clearAuthFlowCookies(reply);

    return reply.redirect(returnTo);
  });

  app.get("/logout", async (_request, reply) => {
    setNoStoreHeaders(reply);
    clearSessionCookie(reply);
    clearEntryValidationCookies(reply);
    clearAuthFlowCookies(reply);

    const curatorLogoutUrl =
      process.env.CURATOR_LOGOUT_URL || "https://qa.analytics.enplify.de/user/logout";

    return reply.redirect(curatorLogoutUrl);
  });

  app.post("/logout", async (_request, reply) => {
    setNoStoreHeaders(reply);
    clearSessionCookie(reply);
    clearEntryValidationCookies(reply);
    clearAuthFlowCookies(reply);

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
    clearEntryValidationCookies(reply);
    clearAuthFlowCookies(reply);

    return {
      result: "ok",
      message: "Local auth session cleared"
    };
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "auth-api"
    };
  });
}
