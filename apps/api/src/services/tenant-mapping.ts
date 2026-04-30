import { db } from "../lib/db";

export type TenantMapping = {
  id: string;
  curator_group_id: string;
  tenant_key: string;
  sharepoint_site_id: string;
  sharepoint_drive_id: string;
  root_folder_id: string;
  display_name: string;
  is_active: boolean;
  upload_enabled: boolean;
  max_upload_bytes: number;
  allowed_extensions: string[];
  allowed_mime_types: string[];
};

export async function getTenantMappingByCuratorGroupId(
  curatorGroupId: string
): Promise<TenantMapping | null> {
  const result = await db.query(
    `
      select
        id,
        curator_group_id,
        tenant_key,
        sharepoint_site_id,
        sharepoint_drive_id,
        root_folder_id,
        display_name,
        is_active,
        upload_enabled,
        max_upload_bytes,
        allowed_extensions,
        allowed_mime_types
      from tenant_mappings
      where curator_group_id = $1
        and is_active = true
      limit 1
    `,
    [curatorGroupId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    ...row,
    max_upload_bytes: Number(row.max_upload_bytes),
    allowed_extensions: row.allowed_extensions ?? [],
    allowed_mime_types: row.allowed_mime_types ?? []
  } as TenantMapping;
}
