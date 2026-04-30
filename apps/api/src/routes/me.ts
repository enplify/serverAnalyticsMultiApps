import { FastifyInstance } from "fastify";
import { MeResponse } from "@portal/shared";
import { resolveTenantContext } from "../middleware/tenant-context";

export async function meRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { preHandler: resolveTenantContext },
    async (request): Promise<MeResponse> => {
      const tenant = request.tenantMapping!;
      const curatorGroupId = request.curatorGroupId!;
      const session = request.docsSession;

      return {
        user: {
          id: session ? String(session.curatorUserId) : "dev-user",
          displayName: session ? session.fullName : "Development User",
          email: session ? session.email : "dev@example.com",
          curatorGroupId
        },
        tenant: {
          tenantKey: tenant.tenant_key,
          displayName: tenant.display_name,
          uploadEnabled: tenant.upload_enabled,
          maxUploadBytes: Number(tenant.max_upload_bytes),
          allowedExtensions: tenant.allowed_extensions
        }
      };
    }
  );
}