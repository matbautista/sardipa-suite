import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { requireAgencySession } from "@/lib/session";
import { getDocumentForDownload } from "@/lib/documents";
import { classifyFsError } from "@/lib/storage-health";

// Authenticated file-serving route (Section 5's "How Documents Are Saved,"
// step 4): the backend never exposes a storage location as a raw static
// directory. Every request here re-checks the requester's agency and
// policy-ownership against the Document row before ever reading a file
// from disk — a cross-tenant or cross-owner id is a 404, not a redirect,
// so it doesn't even confirm the document exists.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAgencySession();
  const { id } = await params;

  const document = await getDocumentForDownload(session.user.agencyId, session.user.id, session.user.role, id);
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(document.absolutePath);
  } catch (error) {
    // Section 9's failure table, "a storage location is disconnected or
    // unreachable" row — this is the read-time version of that (the write
    // side has its own handling in documents.ts's uploadDocument).
    console.error(`[documents] read failed for ${document.absolutePath}:`, error);
    const kind = classifyFsError(error);
    const message =
      kind === "full"
        ? "This document can't be read right now — the storage drive reported an error. Contact your Super Admin."
        : `Documents on "${document.locationLabel}" are temporarily unavailable — the drive may be disconnected. Try again later.`;
    return NextResponse.json({ error: message }, { status: 503 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": document.contentType,
      "Content-Disposition": `inline; filename="${document.fileName}"`,
    },
  });
}
