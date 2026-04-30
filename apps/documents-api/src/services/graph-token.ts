let cachedToken: {
  accessToken: string;
  expiresAt: number;
} | null = null;

export async function getGraphAccessToken(): Promise<string> {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenantId) throw new Error("GRAPH_TENANT_ID is not set");
  if (!clientId) throw new Error("GRAPH_CLIENT_ID is not set");
  if (!clientSecret) throw new Error("GRAPH_CLIENT_SECRET is not set");

  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("scope", "https://graph.microsoft.com/.default");
  body.set("grant_type", "client_credentials");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token request failed: ${res.status} ${text}`);
  }

  const data = await res.json();

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600) * 1000
  };

  return cachedToken.accessToken;
}