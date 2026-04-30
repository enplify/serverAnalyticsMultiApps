import { FastifyReply, FastifyRequest } from "fastify";
import {
  getTenantMappingByCuratorGroupId,
  TenantMapping
} from "../services/tenant-mapping";
import { DocsSession, verifySession } from "../services/session";
import {
  clearSessionCookie,
  SESSION_COOKIE_NAME,
  setNoStoreHeaders
} from "../config/security";

declare module "fastify" {
  interface FastifyRequest {
    curatorGroupId?: string;
    tenantMapping?: TenantMapping;
    docsSession?: DocsSession;
  }
}

function getSessionFromRequest(request: FastifyRequest): DocsSession | null {
  const sessionCookie = request.cookies?.[SESSION_COOKIE_NAME];

  if (!sessionCookie) {
    return null;
  }

  return verifySession(sessionCookie);
}

function getCuratorGroupIdFromRequest(request: FastifyRequest): {
  curatorGroupId: string;
  session: DocsSession | null;
} {
  const session = getSessionFromRequest(request);

  if (session) {
    return {
      curatorGroupId: session.curatorGroupId,
      session
    };
  }

  if (process.env.ALLOW_DEV_AUTH_HEADER === "true") {
    const devHeader = String(request.headers["x-curator-group-id"] || "");

    if (devHeader) {
      return {
        curatorGroupId: devHeader,
        session: null
      };
    }
  }

  return {
    curatorGroupId: "",
    session: null
  };
}

export async function resolveTenantContext(
  request: FastifyRequest,
  reply: FastifyReply
) {
  let resolved: {
    curatorGroupId: string;
    session: DocsSession | null;
  };
  
  setNoStoreHeaders(reply);

  try {
    resolved = getCuratorGroupIdFromRequest(request);
  } catch {
    clearSessionCookie(reply);
    reply.code(401).send({ error: "Invalid session" });
    return;
  }

  if (!resolved.curatorGroupId) {
    reply.code(401).send({ error: "Not authenticated" });
    return;
  }

  const tenantMapping = await getTenantMappingByCuratorGroupId(
    resolved.curatorGroupId
  );

  if (!tenantMapping) {
    reply.code(403).send({ error: "No tenant mapping for curator group" });
    return;
  }

  request.curatorGroupId = resolved.curatorGroupId;
  request.tenantMapping = tenantMapping;
  request.docsSession = resolved.session;
}