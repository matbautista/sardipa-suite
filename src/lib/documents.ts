import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getScopedPrisma } from "@/lib/tenant-db";
import { ensureWritableDirectory } from "@/lib/storage-path";
import { resolveAccessibleOwner } from "@/lib/team-access";

// Document upload/storage (Section 10 phase 9 / Section 5's "How Documents
// Are Saved" and "Upload Limits & Image Sizing"). Client-side image
// compression (resize to ~2000px, ~80% quality) is a recommendation in the
// plan, not a hard requirement — not built here; only the 5MB hard cap is
// enforced, server-side.

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// MIME type -> stored extension. Deliberately keyed by MIME, not filename,
// since the plan requires accepted-type validation and browsers set this
// reliably for the three types in scope.
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

const VALID_DOC_TYPES = ["proof_of_payment", "valid_id", "other"] as const;

type UploadResult = { ok: true; documentId: string } | { ok: false; error: string };

// ownerId: whose policy this is, for the access check (may be resolved to
// someone other than the caller by team-access.ts, phase 12). actorId: who
// actually uploaded it — always the real caller, stored as
// Document.uploadedBy, never resolved to the policy's owner.
export async function uploadDocument(
  agencyId: string,
  policyId: string,
  ownerId: string,
  actorId: string,
  docType: string,
  file: File
): Promise<UploadResult> {
  if (!VALID_DOC_TYPES.includes(docType as (typeof VALID_DOC_TYPES)[number])) {
    return { ok: false, error: "Choose a valid document type." };
  }
  if (!file || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: "File exceeds the 5MB limit." };
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return { ok: false, error: "Only PDF, JPG, and PNG files are accepted." };
  }

  const scoped = getScopedPrisma(agencyId);
  const policy = await scoped.policy.findUnique({ where: { id: policyId } });
  if (!policy || policy.ownerId !== ownerId) {
    return { ok: false, error: "Policy not found." };
  }

  // StorageLocation is host-level, not tenant-scoped — same reasoning
  // src/lib/setup.ts already uses for this exact lookup (Section 2's
  // one-install-per-agency deployment model).
  const location = await prisma.storageLocation.findFirst({ where: { isActive: true } });
  if (!location) {
    return { ok: false, error: "No active storage location is configured. Contact your Super Admin." };
  }

  // The document's own id doubles as its stored filename (never the
  // uploaded filename, to avoid collisions/path issues) — generated
  // upfront and passed into create() explicitly since the path has to be
  // known before the row exists.
  const documentId = randomUUID();
  const relativePath = `${agencyId}/${policyId}/${documentId}.${ext}`;
  const absoluteDir = path.join(location.path, agencyId, policyId);
  ensureWritableDirectory(absoluteDir);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(location.path, relativePath), buffer);

  const document = await scoped.document.create({
    data: {
      id: documentId,
      agencyId,
      policyId,
      storageLocationId: location.id,
      type: docType,
      filePath: relativePath,
      fileSizeBytes: file.size,
      uploadedBy: actorId,
    },
  });

  if (docType === "proof_of_payment") {
    // Always points at the latest Proof of Payment — a renewal upload
    // naturally supersedes an older one this way, no extra bookkeeping.
    await scoped.policy.update({ where: { id: policyId }, data: { proofOfPaymentDocId: document.id } });
  }

  return { ok: true, documentId: document.id };
}

export async function listPolicyDocuments(agencyId: string, ownerId: string, policyId: string) {
  const scoped = getScopedPrisma(agencyId);
  const policy = await scoped.policy.findUnique({ where: { id: policyId } });
  if (!policy || policy.ownerId !== ownerId) {
    return [];
  }
  return scoped.document.findMany({
    where: { policyId },
    orderBy: { uploadedAt: "desc" },
  });
}

type DownloadableDocument = { absolutePath: string; fileName: string; contentType: string };

// This route can't resolve "which owner's records may the caller touch"
// up front the way a policy detail page can — a document download only
// ever gets a documentId, not the policyId needed to check first — so
// unlike everywhere else in this file, the resolution happens inside this
// function itself rather than being handed a pre-resolved ownerId.
export async function getDocumentForDownload(
  agencyId: string,
  callerId: string,
  role: string,
  documentId: string
): Promise<DownloadableDocument | null> {
  const scoped = getScopedPrisma(agencyId);
  const document = await scoped.document.findUnique({
    where: { id: documentId },
    include: { policy: true, storageLocation: true },
  });
  if (!document) {
    return null;
  }
  const accessibleOwnerId = await resolveAccessibleOwner(agencyId, callerId, role, document.policy.ownerId);
  if (!accessibleOwnerId) {
    return null;
  }

  const ext = path.extname(document.filePath).toLowerCase();
  const contentType = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : "image/jpeg";

  return {
    absolutePath: path.join(document.storageLocation.path, document.filePath),
    fileName: path.basename(document.filePath),
    contentType,
  };
}
