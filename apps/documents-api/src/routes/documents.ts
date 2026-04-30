import { FastifyInstance } from "fastify";
import { TreeResponse } from "@portal/shared";
import { resolveTenantContext } from "../middleware/tenant-context";
import {
  assertItemInsideRoot,
  createFolderZipStream,
  createPreviewUrl,
  getDownloadUrl,
  getItem,
  listChildren,
  uploadSmallFile
} from "../services/graph-documents";

function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index === -1) return "";
  return fileName.slice(index).toLowerCase();
}

function normalizeAllowedExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item).toLowerCase())
    .filter(Boolean);
}

function normalizeAllowedMimeTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item).toLowerCase())
    .filter(Boolean);
}

export async function documentRoutes(app: FastifyInstance) {
  app.get(
    "/tree",
    { preHandler: resolveTenantContext },
    async (request, reply): Promise<TreeResponse | { error: string }> => {
      reply.header("Cache-Control", "no-store");

      const tenant = request.tenantMapping!;
      const query = request.query as { parentId?: string };

      const folderId = query.parentId || tenant.root_folder_id;

      try {
        await assertItemInsideRoot({
          driveId: tenant.sharepoint_drive_id,
          rootFolderId: tenant.root_folder_id,
          itemId: folderId
        });

        const currentFolderItem = await getItem({
          driveId: tenant.sharepoint_drive_id,
          itemId: folderId
        });
        
        const items = await listChildren({
          driveId: tenant.sharepoint_drive_id,
          folderId,
          enrichFolders: true
        });
        
        return {
          currentFolder: {
            id: folderId,
            name: currentFolderItem.name,
            path: "/"
          },
          items
        };
      } catch (error) {
        request.log.warn({ error }, "Blocked document tree request");
        reply.code(403);
        return { error: "Folder is outside allowed tenant root" };
      }
    }
  );

  app.get(
    "/item/:itemId/preview",
    { preHandler: resolveTenantContext },
    async (request, reply): Promise<{ url: string } | { error: string }> => {
      reply.header("Cache-Control", "no-store");

      const tenant = request.tenantMapping!;
      const params = request.params as { itemId: string };

      try {
        await assertItemInsideRoot({
          driveId: tenant.sharepoint_drive_id,
          rootFolderId: tenant.root_folder_id,
          itemId: params.itemId
        });

        const item = await getItem({
          driveId: tenant.sharepoint_drive_id,
          itemId: params.itemId
        });

        if (!item.file) {
          reply.code(400);
          return { error: "Only files can be previewed" };
        }

        const url = await createPreviewUrl({
          driveId: tenant.sharepoint_drive_id,
          itemId: params.itemId
        });

        return { url };
      } catch (error) {
        request.log.warn({ error }, "Preview request failed");
        reply.code(403);
        return { error: "Preview not allowed" };
      }
    }
  );

  app.get(
    "/item/:itemId/download",
    { preHandler: resolveTenantContext },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
  
      const tenant = request.tenantMapping!;
      const params = request.params as { itemId: string };
  
      try {
        await assertItemInsideRoot({
          driveId: tenant.sharepoint_drive_id,
          rootFolderId: tenant.root_folder_id,
          itemId: params.itemId
        });
  
        const item = await getItem({
          driveId: tenant.sharepoint_drive_id,
          itemId: params.itemId
        });
  
        if (item.file) {
          const downloadUrl = await getDownloadUrl({
            driveId: tenant.sharepoint_drive_id,
            itemId: params.itemId
          });
  
          return reply.redirect(downloadUrl);
        }
  
        if (item.folder) {
          const zipName = `${item.name.replace(/[\\/:*?"<>|]/g, "_")}.zip`;
  
          const archive = await createFolderZipStream({
            driveId: tenant.sharepoint_drive_id,
            folderId: params.itemId,
            folderName: item.name
          });
  
          reply.raw.writeHead(200, {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(zipName)}"`,
            "Cache-Control": "no-store"
          });
  
          archive.pipe(reply.raw);
          return reply;
        }
  
        reply.code(400);
        return { error: "Item cannot be downloaded" };
      } catch (error) {
        request.log.warn({ error }, "Download request failed");
        reply.code(403);
        return { error: "Download not allowed" };
      }
    }
  );

  app.post(
    "/upload",
    { preHandler: resolveTenantContext },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");

      const tenant = request.tenantMapping!;
      const query = request.query as { parentId?: string };

      if (!tenant.upload_enabled) {
        reply.code(403);
        return { error: "Upload is disabled for this tenant" };
      }

      const parentFolderId = query.parentId || tenant.root_folder_id;

      try {
        await assertItemInsideRoot({
          driveId: tenant.sharepoint_drive_id,
          rootFolderId: tenant.root_folder_id,
          itemId: parentFolderId
        });
        
        const uploadTargetFolder = await getItem({
          driveId: tenant.sharepoint_drive_id,
          itemId: parentFolderId
        });
        
        if (uploadTargetFolder.name.trim().toLowerCase() !== "upload") {
          reply.code(403);
          return { error: "Upload is only allowed in the Upload folder" };
        }

        const part = await request.file();

        if (!part) {
          reply.code(400);
          return { error: "No file uploaded" };
        }

        const fileName = part.filename;
        const extension = getFileExtension(fileName);
        const mimeType = String(part.mimetype || "").toLowerCase();

        const allowedExtensions = normalizeAllowedExtensions(tenant.allowed_extensions);
        const allowedMimeTypes = normalizeAllowedMimeTypes(tenant.allowed_mime_types);

        if (allowedExtensions.length > 0 && !allowedExtensions.includes(extension)) {
          reply.code(400);
          return { error: `File extension ${extension} is not allowed` };
        }

        if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(mimeType)) {
          reply.code(400);
          return { error: `Mime type ${mimeType} is not allowed` };
        }

        const buffer = await part.toBuffer();

        if (buffer.length > Number(tenant.max_upload_bytes)) {
          reply.code(400);
          return { error: "File exceeds tenant upload limit" };
        }

        const uploaded = await uploadSmallFile({
          driveId: tenant.sharepoint_drive_id,
          parentFolderId,
          fileName,
          contentType: mimeType,
          buffer
        });

        return {
          result: "ok",
          item: uploaded
        };
      } catch (error) {
        request.log.warn({ error }, "Upload request failed");
        reply.code(500);
        return { error: "Upload failed" };
      }
    }
  );
}