import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DocumentApp } from "@/components/DocumentApp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DOCUMENT_ENTRY_VALIDATION_COOKIE_NAME = "docs_entry_validated";

function shouldForceCuratorRevalidation(): boolean {
  return process.env.DOCUMENTS_FORCE_CURATOR_REVALIDATION !== "false";
}

function getAuthStartUrl(): string {
  const authBaseUrl = process.env.AUTH_BASE_URL;
  const appBaseUrl = process.env.APP_BASE_URL;

  if (!authBaseUrl) {
    return "/api/auth/curator/start?returnTo=%2Fdocuments";
  }

  const returnTo = appBaseUrl
    ? `${appBaseUrl.replace(/\/+$/, "")}/documents`
    : "/documents";

  return `${authBaseUrl.replace(/\/+$/, "")}/api/auth/curator/start?app=documents&returnTo=${encodeURIComponent(returnTo)}`;
}

export default async function DocumentsPage() {
  if (shouldForceCuratorRevalidation()) {
    const cookieStore = await cookies();
    const hasFreshCuratorValidation =
      cookieStore.get(DOCUMENT_ENTRY_VALIDATION_COOKIE_NAME)?.value === "1";

    if (!hasFreshCuratorValidation) {
      redirect(getAuthStartUrl());
    }
  }

  return <DocumentApp />;
}
