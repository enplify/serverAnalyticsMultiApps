import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ENTRY_VALIDATION_COOKIE_NAME = "project1_entry_validated";

function getAuthStartUrl(): string {
  const authBaseUrl = process.env.AUTH_BASE_URL;
  const appBaseUrl = process.env.PROJECT1_APP_BASE_URL;

  if (!authBaseUrl) {
    throw new Error("AUTH_BASE_URL is required");
  }

  if (!appBaseUrl) {
    throw new Error("PROJECT1_APP_BASE_URL is required");
  }

  return `${authBaseUrl.replace(/\/+$/, "")}/api/auth/curator/start?app=project1&returnTo=${encodeURIComponent(
    appBaseUrl
  )}`;
}

async function getProject1Data(cookieHeader: string) {
  const apiBaseUrl =
    process.env.PROJECT1_API_BASE_URL ||
    "https://projekt1.qa.analytics.enplify.de";

  const response = await fetch(
    `${apiBaseUrl.replace(/\/+$/, "")}/api/project1/data`,
    {
      cache: "no-store",
      headers: {
        cookie: cookieHeader
      }
    }
  );

  if (!response.ok) {
    return {
      status: "error",
      statusCode: response.status,
      body: await response.text()
    };
  }

  return response.json();
}

export default async function Project1Page() {
  const cookieStore = await cookies();

  const hasFreshValidation =
    cookieStore.get(ENTRY_VALIDATION_COOKIE_NAME)?.value === "1";

  if (!hasFreshValidation) {
    redirect(getAuthStartUrl());
  }

  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  const data = await getProject1Data(cookieHeader);

  return (
    <main
      style={{
        fontFamily: "Arial, sans-serif",
        padding: 32,
        maxWidth: 960,
        margin: "0 auto"
      }}
    >
      <h1>Projekt 1</h1>
      <p>Diese Webapp läuft getrennt von Dokumente und nutzt dieselbe zentrale Authentifizierung.</p>

      <section
        style={{
          marginTop: 24,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 8,
          background: "#fafafa"
        }}
      >
        <h2>Authentifizierter API-Test</h2>
        <pre
          style={{
            overflow: "auto",
            whiteSpace: "pre-wrap"
          }}
        >
          {JSON.stringify(data, null, 2)}
        </pre>
      </section>
    </main>
  );
}
