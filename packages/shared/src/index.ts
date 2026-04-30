export type TenantInfo = {
  tenantKey: string;
  displayName: string;
  uploadEnabled: boolean;
  maxUploadBytes: number;
  allowedExtensions: string[];
};

export type UserInfo = {
  id: string;
  displayName: string;
  email: string;
  curatorGroupId: string;
};

export type MeResponse = {
  user: UserInfo;
  tenant: TenantInfo;
};

export type DocumentItem = {
  id: string;
  name: string;
  type: "file" | "folder";
  size: number;
  mimeType?: string;
  lastModifiedAt: string;
  previewable: boolean;
  downloadable: boolean;
};

export type TreeResponse = {
  currentFolder: {
    id: string;
    name: string;
    path: string;
  };
  items: DocumentItem[];
};
