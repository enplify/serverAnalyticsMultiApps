import { Readable } from "stream";
import archiver from "archiver";
import { getGraphAccessToken } from "./graph-token";

type GraphDriveItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  file?: {
    mimeType?: string;
  };
  folder?: {
    childCount?: number;
  };
  parentReference?: {
    driveId?: string;
    id?: string;
    path?: string;
  };
  "@microsoft.graph.downloadUrl"?: string;
};

type GraphCollection<T> = {
  value: T[];
  "@odata.nextLink"?: string;
};

export type NormalizedDocumentItem = {
  id: string;
  name: string;
  type: "file" | "folder";
  size: number;
  mimeType?: string;
  lastModifiedAt: string;
  previewable: boolean;
  downloadable: boolean;
};

export type FolderStats = {
  size: number;
  lastModifiedAt: string;
};

export type FolderZipEntry = {
  itemId: string;
  path: string;
};

function isPreviewable(item: GraphDriveItem): boolean {
  if (!item.file?.mimeType) return false;

  const mimeType = item.file.mimeType.toLowerCase();

  return [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ].includes(mimeType);
}

function normalizeDriveItem(item: GraphDriveItem): NormalizedDocumentItem {
  const isFolder = Boolean(item.folder);

  return {
    id: item.id,
    name: item.name,
    type: isFolder ? "folder" : "file",
    size: item.size ?? 0,
    mimeType: item.file?.mimeType,
    lastModifiedAt: item.lastModifiedDateTime ?? new Date(0).toISOString(),
    previewable: !isFolder && isPreviewable(item),
    downloadable: true
  };
}

function sanitizeFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    throw new Error("Invalid file name");
  }

  return cleaned;
}

async function graphGet<T>(url: string): Promise<T> {
  const token = await getGraphAccessToken();

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph GET failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

async function graphPost<T>(url: string, body?: unknown): Promise<T> {
  const token = await getGraphAccessToken();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph POST failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

async function listChildrenRaw(params: {
  driveId: string;
  folderId: string;
}): Promise<GraphDriveItem[]> {
  let url =
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(params.driveId)}` +
    `/items/${encodeURIComponent(params.folderId)}/children` +
    `?$select=id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference` +
    `&$top=200`;

  const allItems: GraphDriveItem[] = [];

  while (url) {
    const data = await graphGet<GraphCollection<GraphDriveItem>>(url);
    allItems.push(...data.value);
    url = data["@odata.nextLink"] || "";
  }

  return allItems;
}

function newestDate(a: string, b: string): string {
  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();

  if (Number.isNaN(aTime)) return b;
  if (Number.isNaN(bTime)) return a;

  return bTime > aTime ? b : a;
}

export async function getFolderStats(params: {
  driveId: string;
  folderId: string;
}): Promise<FolderStats> {
  const children = await listChildrenRaw({
    driveId: params.driveId,
    folderId: params.folderId
  });

  let totalSize = 0;
  let latest = new Date(0).toISOString();

  for (const child of children) {
    const childModified = child.lastModifiedDateTime ?? new Date(0).toISOString();

    if (child.file) {
      totalSize += child.size ?? 0;
      latest = newestDate(latest, childModified);
      continue;
    }

    if (child.folder) {
      const nested = await getFolderStats({
        driveId: params.driveId,
        folderId: child.id
      });

      totalSize += nested.size;
      latest = newestDate(latest, nested.lastModifiedAt);
      latest = newestDate(latest, childModified);
    }
  }

  return {
    size: totalSize,
    lastModifiedAt: latest
  };
}

export async function listChildren(params: {
  driveId: string;
  folderId: string;
  enrichFolders?: boolean;
}): Promise<NormalizedDocumentItem[]> {
  const rawItems = await listChildrenRaw({
    driveId: params.driveId,
    folderId: params.folderId
  });

  const normalized: NormalizedDocumentItem[] = [];

  for (const item of rawItems) {
    const normalizedItem = normalizeDriveItem(item);

    if (params.enrichFolders && item.folder) {
      const stats = await getFolderStats({
        driveId: params.driveId,
        folderId: item.id
      });

      normalizedItem.size = stats.size;
      normalizedItem.lastModifiedAt = stats.lastModifiedAt;
      normalizedItem.downloadable = true;
    }

    normalized.push(normalizedItem);
  }

  return normalized.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "de");
  });
}

export async function getItem(params: {
  driveId: string;
  itemId: string;
}): Promise<GraphDriveItem> {
  const url =
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(params.driveId)}` +
    `/items/${encodeURIComponent(params.itemId)}` +
    `?$select=id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference`;

  return graphGet<GraphDriveItem>(url);
}

export async function assertItemInsideRoot(params: {
  driveId: string;
  rootFolderId: string;
  itemId: string;
}): Promise<void> {
  if (params.itemId === params.rootFolderId) {
    return;
  }

  let current = await getItem({
    driveId: params.driveId,
    itemId: params.itemId
  });

  for (let depth = 0; depth < 30; depth++) {
    const parentId = current.parentReference?.id;

    if (!parentId) break;

    if (parentId === params.rootFolderId) {
      return;
    }

    current = await getItem({
      driveId: params.driveId,
      itemId: parentId
    });
  }

  throw new Error("Item is outside tenant root");
}

export async function createPreviewUrl(params: {
  driveId: string;
  itemId: string;
}): Promise<string> {
  const url =
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(params.driveId)}` +
    `/items/${encodeURIComponent(params.itemId)}/preview`;

  const data = await graphPost<{ getUrl?: string }>(url, {});

  if (!data.getUrl) {
    throw new Error("Graph preview response did not contain getUrl");
  }

  return data.getUrl;
}

export async function getDownloadUrl(params: {
  driveId: string;
  itemId: string;
}): Promise<string> {
  const token = await getGraphAccessToken();

  const url =
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(params.driveId)}` +
    `/items/${encodeURIComponent(params.itemId)}/content`;

  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const location = res.headers.get("location");

  if (res.status >= 300 && res.status < 400 && location) {
    return location;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph download failed: ${res.status} ${text}`);
  }

  throw new Error("Graph download did not return redirect location");
}

export async function uploadSmallFile(params: {
  driveId: string;
  parentFolderId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}): Promise<NormalizedDocumentItem> {
  const token = await getGraphAccessToken();
  const fileName = sanitizeFileName(params.fileName);

  const url =
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(params.driveId)}` +
    `/items/${encodeURIComponent(params.parentFolderId)}` +
    `:/${encodeURIComponent(fileName)}:/content`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": params.contentType || "application/octet-stream"
    },
    body: params.buffer
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph upload failed: ${res.status} ${text}`);
  }

  const item = (await res.json()) as GraphDriveItem;

  return normalizeDriveItem(item);
}

export async function collectFolderFiles(params: {
  driveId: string;
  folderId: string;
  basePath?: string;
}): Promise<FolderZipEntry[]> {
  const children = await listChildrenRaw({
    driveId: params.driveId,
    folderId: params.folderId
  });

  const entries: FolderZipEntry[] = [];

  for (const child of children) {
    const safeName = sanitizeFileName(child.name);
    const path = params.basePath ? `${params.basePath}/${safeName}` : safeName;

    if (child.file) {
      entries.push({
        itemId: child.id,
        path
      });
      continue;
    }

    if (child.folder) {
      const nested = await collectFolderFiles({
        driveId: params.driveId,
        folderId: child.id,
        basePath: path
      });

      entries.push(...nested);
    }
  }

  return entries;
}

export async function createFolderZipStream(params: {
  driveId: string;
  folderId: string;
  folderName: string;
}): Promise<archiver.Archiver> {
  const entries = await collectFolderFiles({
    driveId: params.driveId,
    folderId: params.folderId
  });

  const archive = archiver("zip", {
    zlib: { level: 9 }
  });

  process.nextTick(async () => {
    try {
      if (entries.length === 0) {
        archive.append("", { name: `${sanitizeFileName(params.folderName)}/.empty` });
      }

      for (const entry of entries) {
        const downloadUrl = await getDownloadUrl({
          driveId: params.driveId,
          itemId: entry.itemId
        });

        const fileRes = await fetch(downloadUrl);

        if (!fileRes.ok || !fileRes.body) {
          throw new Error(`Failed to fetch file for zip: ${entry.path}`);
        }

        const stream = Readable.fromWeb(fileRes.body as any);
        archive.append(stream, { name: entry.path });
      }

      await archive.finalize();
    } catch (error) {
      archive.destroy(error as Error);
    }
  });

  return archive;
}