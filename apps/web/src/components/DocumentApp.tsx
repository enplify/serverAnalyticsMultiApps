"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

type MeResponse = {
  user: {
    id: string;
    displayName: string;
    email: string;
    curatorGroupId: string;
  };
  tenant: {
    tenantKey: string;
    displayName: string;
    uploadEnabled: boolean;
    maxUploadBytes: number;
    allowedExtensions: string[];
  };
};

type DocumentItem = {
  id: string;
  name: string;
  type: "file" | "folder";
  size: number;
  mimeType?: string;
  lastModifiedAt: string;
  previewable: boolean;
  downloadable: boolean;
};

type TreeResponse = {
  currentFolder: {
    id: string;
    name: string;
    path: string;
  };
  items: DocumentItem[];
};

type FolderStackItem = {
  id?: string;
  name: string;
};

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";

  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;

  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;

  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: "100%",
    padding: "24px 0",
    fontFamily: "Arial, sans-serif",
    color: "#111",
    boxSizing: "border-box"
  },
  content: {
    width: "100%",
    maxWidth: "1240px",
    margin: "0 auto",
    padding: "0 24px",
    boxSizing: "border-box"
  },
  breadcrumb: {
    marginBottom: "1rem",
    whiteSpace: "nowrap",
    overflowX: "auto",
    fontSize: "18px",
    fontWeight: 600
  },
  toolbar: {
    display: "flex",
    gap: "0.75rem",
    alignItems: "center",
    marginBottom: "1rem",
    flexWrap: "nowrap"
  },
  button: {
    padding: "0.45rem 0.8rem",
    border: "1px solid #aaa",
    background: "#f8f8f8",
    cursor: "pointer",
    whiteSpace: "nowrap"
  },
  buttonDisabled: {
    padding: "0.45rem 0.8rem",
    border: "1px solid #ddd",
    background: "#eee",
    color: "#888",
    cursor: "default",
    whiteSpace: "nowrap"
  },
  linkButton: {
    background: "none",
    border: "none",
    padding: 0,
    color: "#0645ad",
    textDecoration: "underline",
    cursor: "pointer",
    font: "inherit"
  },
  messageArea: {
    minHeight: "28px",
    marginBottom: "0.75rem",
    display: "flex",
    alignItems: "center",
    fontSize: "14px"
  },
  error: {
    color: "#b00020",
    margin: 0
  },
  info: {
    color: "green",
    margin: 0
  },
  tableWrap: {
    width: "100%"
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
    border: "1px solid #ddd",
    tableLayout: "fixed"
  },
  th: {
    borderBottom: "1px solid #ddd",
    padding: "0.7rem 0.6rem",
    background: "#f7f7f7",
    whiteSpace: "nowrap"
  },
  td: {
    borderBottom: "1px solid #eee",
    padding: "0.7rem 0.6rem",
    verticalAlign: "middle"
  },
  fileName: {
    overflowWrap: "anywhere"
  },
  actions: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "nowrap",
    alignItems: "center"
  },
  previewOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.65)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem"
  },
  previewBox: {
    width: "92vw",
    height: "92vh",
    background: "#fff",
    display: "flex",
    flexDirection: "column",
    borderRadius: "4px",
    overflow: "hidden"
  },
  previewHeader: {
    padding: "0.75rem 1rem",
    borderBottom: "1px solid #ddd",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  iframe: {
    border: 0,
    width: "100%",
    height: "100%"
  }
};

export function DocumentApp() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tree, setTree] = useState<TreeResponse | null>(null);
  const [folderStack, setFolderStack] = useState<FolderStackItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [folderLoading, setFolderLoading] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string>("Vorschau");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function getCurrentFolderId(): string | undefined {
    return folderStack[folderStack.length - 1]?.id;
  }
  
  function getVisibleFolderStack(): FolderStackItem[] {
    if (folderStack.length > 0) {
      return folderStack;
    }
  
    if (tree?.currentFolder?.name) {
      return [
        {
          id: undefined,
          name: tree.currentFolder.name
        }
      ];
    }
  
    return [];
  }

  function isCurrentUploadFolder(): boolean {
    const current = folderStack[folderStack.length - 1];

    return current?.name.trim().toLowerCase() === "upload";
  }

  function canUploadHere(): boolean {
    return Boolean(me?.tenant.uploadEnabled && isCurrentUploadFolder());
  }

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
    const res = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...init
    });

    if (res.status === 401) {
      window.location.href = "/api/auth/curator/start";
      return null;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Request failed: ${res.status}${body ? ` - ${body}` : ""}`);
    }

    return (await res.json()) as T;
  }

  async function loadTree(parentId?: string): Promise<TreeResponse | null> {
    setFolderLoading(true);

    try {
      const url = parentId
        ? `/api/documents/tree?parentId=${encodeURIComponent(parentId)}`
        : "/api/documents/tree";

      const data = await fetchJson<TreeResponse>(url);

      if (data) {
        setTree(data);
        return data;
      }
      return null;
    } finally {
      setFolderLoading(false);
    }
  }

  async function loadInitialData(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const meJson = await fetchJson<MeResponse>("/api/me");
      if (!meJson) return;

      setMe(meJson);
      const rootTree = await loadTree();

      if (rootTree) {
        setFolderStack([
          {
            id: undefined,
            name: rootTree.currentFolder.name
          }
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  function openFolder(item: DocumentItem): void {
    if (item.type !== "folder") return;

    setError(null);
    setInfo(null);
    setFolderStack((current) => [...current, { id: item.id, name: item.name }]);

    loadTree(item.id).catch((err) => {
      setError(err instanceof Error ? err.message : "Unknown error");
    });
  }

  function openBreadcrumb(index: number): void {
    const target = folderStack[index];
    const nextStack = folderStack.slice(0, index + 1);

    setError(null);
    setInfo(null);
    setFolderStack(nextStack);

    loadTree(target.id).catch((err) => {
      setError(err instanceof Error ? err.message : "Unknown error");
    });
  }

  function reloadCurrentFolder(): void {
    setError(null);
    setInfo(null);

    loadTree(getCurrentFolderId()).catch((err) => {
      setError(err instanceof Error ? err.message : "Unknown error");
    });
  }

  async function openPreview(item: DocumentItem): Promise<void> {
    setError(null);
    setInfo(null);

    const data = await fetchJson<{ url: string }>(
      `/api/documents/item/${encodeURIComponent(item.id)}/preview`
    );

    if (!data) return;

    setPreviewTitle(item.name);
    setPreviewUrl(data.url);
  }

  function downloadFile(item: DocumentItem): void {
    window.location.href = `/api/documents/item/${encodeURIComponent(item.id)}/download`;
  }

  function triggerUpload(): void {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];

    if (!file) return;

    setError(null);
    setInfo(null);

    if (me && file.size > me.tenant.maxUploadBytes) {
      setError(
        `Die Datei ist zu groß. Maximal erlaubt: ${formatFileSize(me.tenant.maxUploadBytes)}.`
      );
      event.target.value = "";
      return;
    }

    const extension = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
      : "";

    if (
      me &&
      me.tenant.allowedExtensions.length > 0 &&
      !me.tenant.allowedExtensions.map((value) => value.toLowerCase()).includes(extension)
    ) {
      setError(`Dateiendung ${extension || "(keine)"} ist nicht erlaubt.`);
      event.target.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const parentId = getCurrentFolderId();

    const url = parentId
      ? `/api/documents/upload?parentId=${encodeURIComponent(parentId)}`
      : "/api/documents/upload";

    setUploading(true);

    try {
      await fetchJson<{ result: string; item: DocumentItem }>(url, {
        method: "POST",
        body: formData
      });

      setInfo(`Datei "${file.name}" wurde hochgeladen.`);
      await loadTree(parentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  useEffect(() => {
    loadInitialData().catch((err) => {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <main
        style={{
          ...styles.page,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "360px"
        }}
      >
        <img
          src="/loading.gif"
          alt="Lädt..."
          style={{
            width: "500px",
            height: "500px",
            objectFit: "contain"
          }}
        />
      </main>
    );
  }

  if (error && !tree) {
    return (
      <main style={styles.page}>
        <h1>Dokumentenbereich</h1>
        <p style={styles.error}>{error}</p>
        <button type="button" style={styles.button} onClick={() => loadInitialData()}>
          Erneut versuchen
        </button>
      </main>
    );
  }

  if (!me || !tree) {
    return (
      <main style={styles.page}>
        <h1>Dokumentenbereich</h1>
        <p>Keine Daten verfügbar.</p>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.content}>
        <nav aria-label="Breadcrumb" style={styles.breadcrumb}>
          {getVisibleFolderStack().map((folder, index, visibleStack) => (
            <span key={`${folder.id ?? "root"}-${index}`}>
              <button
                type="button"
                onClick={() => openBreadcrumb(index)}
                disabled={folderLoading || index === visibleStack.length - 1}
                style={{
                  ...styles.linkButton,
                  color: index === visibleStack.length - 1 ? "#222" : "#0645ad",
                  textDecoration: index === visibleStack.length - 1 ? "none" : "underline",
                  cursor:
                    folderLoading || index === visibleStack.length - 1
                      ? "default"
                      : "pointer",
                  fontWeight: index === visibleStack.length - 1 ? 700 : 400
                }}
              >
                {folder.name}
              </button>
              {index < visibleStack.length - 1 ? " / " : ""}
            </span>
          ))}
        </nav>
  
        <div style={styles.toolbar}>
          <strong>Dokumente</strong>
  
          <button
            type="button"
            onClick={reloadCurrentFolder}
            disabled={folderLoading || uploading}
            style={folderLoading || uploading ? styles.buttonDisabled : styles.button}
          >
            Aktualisieren
          </button>
  
          {canUploadHere() ? (
            <>
              <button
                type="button"
                onClick={triggerUpload}
                disabled={folderLoading || uploading}
                style={folderLoading || uploading ? styles.buttonDisabled : styles.button}
              >
                Upload
              </button>
  
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={handleFileSelected}
                accept={me.tenant.allowedExtensions.join(",")}
              />
            </>
          ) : null}
  
          {folderLoading ? <span>Lädt Ordner…</span> : null}
          {uploading ? <span>Upload läuft…</span> : null}
        </div>
  
        <div style={styles.messageArea}>
          {error ? <p style={styles.error}>{error}</p> : null}
          {!error && info ? <p style={styles.info}>{info}</p> : null}
        </div>
  
        {tree.items.length === 0 ? (
          <p>Dieser Ordner ist leer.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table cellPadding="0" style={styles.table}>
              <colgroup>
                <col style={{ width: "90px" }} />
                <col />
                <col style={{ width: "120px" }} />
                <col style={{ width: "190px" }} />
                <col style={{ width: "220px" }} />
              </colgroup>
  
              <thead>
                <tr>
                  <th align="left" style={styles.th}>Typ</th>
                  <th align="left" style={styles.th}>Name</th>
                  <th align="right" style={styles.th}>Größe</th>
                  <th align="left" style={styles.th}>Geändert</th>
                  <th align="left" style={styles.th}>Aktionen</th>
                </tr>
              </thead>
  
              <tbody>
                {tree.items.map((item) => (
                  <tr key={item.id}>
                    <td style={styles.td}>{item.type === "folder" ? "Ordner" : "Datei"}</td>
  
                    <td style={{ ...styles.td, ...styles.fileName }}>
                      {item.type === "folder" ? (
                        <button
                          type="button"
                          onClick={() => openFolder(item)}
                          disabled={folderLoading}
                          style={{
                            ...styles.linkButton,
                            cursor: folderLoading ? "default" : "pointer"
                          }}
                        >
                          {item.name}
                        </button>
                      ) : (
                        item.name
                      )}
                    </td>
  
                    <td align="right" style={styles.td}>
                      {formatFileSize(item.size)}
                    </td>
  
                    <td style={styles.td}>{formatDate(item.lastModifiedAt)}</td>
  
                    <td style={styles.td}>
                      <div style={styles.actions}>
                        {item.type === "file" && item.previewable ? (
                          <button
                            type="button"
                            onClick={() => openPreview(item)}
                            style={styles.button}
                          >
                            Vorschau
                          </button>
                        ) : null}
  
                        {item.downloadable ? (
                          <button
                            type="button"
                            onClick={() => downloadFile(item)}
                            style={styles.button}
                          >
                            Download
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
  
        {previewUrl ? (
          <div style={styles.previewOverlay}>
            <div style={styles.previewBox}>
              <div style={styles.previewHeader}>
                <strong>{previewTitle}</strong>
                <button type="button" onClick={() => setPreviewUrl(null)} style={styles.button}>
                  Schließen
                </button>
              </div>
  
              <iframe
                src={previewUrl}
                title={previewTitle}
                style={styles.iframe}
                allowFullScreen
              />
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}