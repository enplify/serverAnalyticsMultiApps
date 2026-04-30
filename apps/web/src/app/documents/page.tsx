import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DocumentApp } from "@/components/DocumentApp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DOCUMENT_ENTRY_VALIDATION_COOKIE_NAME = "docs_entry_validated";

function shouldForceCuratorRevalidation(): boolean {
  return process.env.DOCUMENTS_FORCE_CURATOR_REVALIDATION !== "false";
}

export default async function DocumentsPage() {
  if (shouldForceCuratorRevalidation()) {
    const cookieStore = await cookies();
    const hasFreshCuratorValidation =
      cookieStore.get(DOCUMENT_ENTRY_VALIDATION_COOKIE_NAME)?.value === "1";

    if (!hasFreshCuratorValidation) {
      redirect("/api/auth/curator/start?returnTo=%2Fdocuments");
    }
  }

  return <DocumentApp />;
}
