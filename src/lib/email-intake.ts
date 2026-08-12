import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "@/lib/prisma";
import { getScopedPrisma } from "@/lib/tenant-db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// Website Inquiry Intake (Section 10 phase 14 / Section 5's "Website
// Inquiry Intake (Client-Facing Site -> Leads)"). The client-facing site
// itself isn't built yet (Section 12's open action items) so this module
// also defines — in the absence of a real site to match against — the
// structured field-label format the poller expects an inquiry email's body
// to use:
//
//   Name: Juan Dela Cruz
//   Phone: 09171234567
//   Email: juan@example.com
//   Insurance Line: Life
//   Message: Interested in a family plan
//
// One "Label: value" per line, case-insensitive labels, in any order/subset
// except Name (required to count as "matched the expected format" at all —
// see parseStructuredInquiry below). "Insurance Line" must be the exact
// line identifier/name the agency configured (Section 5 point 7) so it can
// be matched unambiguously; Phone/Email/Message are optional. Whoever
// builds the actual public-facing form should send its emails in this
// shape (or this parser gets adjusted to match whatever it actually sends
// — nothing here is a hard external contract yet).

type ActionResult = { ok: true } | { ok: false; error: string };

export type EmailIntakeConfigInput = {
  imapHost: string;
  imapPort: number;
  username: string;
  // Empty string on an update means "keep the existing password" — there's
  // no way to show it back for editing (Section 6: "never shown again
  // after entry"), so a blank field can't mean "clear it" either.
  password: string;
  folder: string;
  useSsl: boolean;
  isEnabled: boolean;
};

export async function getEmailIntakeConfig(agencyId: string) {
  const scoped = getScopedPrisma(agencyId);
  const config = await scoped.emailIntakeConfig.findUnique({ where: { agencyId } });
  return config;
}

export async function saveEmailIntakeConfig(agencyId: string, input: EmailIntakeConfigInput): Promise<ActionResult> {
  const trimmedHost = input.imapHost.trim();
  const trimmedUsername = input.username.trim();
  const trimmedFolder = input.folder.trim() || "INBOX";

  if (!trimmedHost) {
    return { ok: false, error: "IMAP host is required." };
  }
  if (!Number.isInteger(input.imapPort) || input.imapPort < 1 || input.imapPort > 65535) {
    return { ok: false, error: "Enter a valid port number." };
  }
  if (!trimmedUsername) {
    return { ok: false, error: "Username is required." };
  }

  const scoped = getScopedPrisma(agencyId);
  const existing = await scoped.emailIntakeConfig.findUnique({ where: { agencyId } });

  if (!existing && !input.password) {
    return { ok: false, error: "Password is required when setting up mailbox intake for the first time." };
  }

  const encryptedPassword = input.password ? encryptSecret(input.password) : existing!.encryptedPassword;

  await scoped.emailIntakeConfig.upsert({
    where: { agencyId },
    create: {
      agencyId,
      imapHost: trimmedHost,
      imapPort: input.imapPort,
      username: trimmedUsername,
      encryptedPassword,
      folder: trimmedFolder,
      useSsl: input.useSsl,
      isEnabled: input.isEnabled,
    },
    update: {
      imapHost: trimmedHost,
      imapPort: input.imapPort,
      username: trimmedUsername,
      encryptedPassword,
      folder: trimmedFolder,
      useSsl: input.useSsl,
      isEnabled: input.isEnabled,
      // A credentials/settings change deserves a clean slate on the error
      // state — the next poll should speak for itself rather than showing
      // a stale failure from before the fix.
      lastErrorAt: null,
      lastErrorMessage: null,
    },
  });

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Structured-email parsing (Section 5 points 4-7)
// ─────────────────────────────────────────────────────────────────────────

type ParsedInquiry = {
  // False when no "Name:" field could be found at all — the "doesn't match
  // the expected structured format" case (point 5), e.g. a direct reply to
  // the inbox rather than a form submission.
  matchedFormat: boolean;
  name: string;
  phone: string | null;
  email: string | null;
  lineName: string | null;
  message: string | null;
};

function parseStructuredInquiry(subject: string, bodyText: string): ParsedInquiry {
  const fields: Record<string, string> = {};
  for (const rawLine of bodyText.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.+)$/);
    if (match) {
      const label = match[1].trim().toLowerCase();
      const value = match[2].trim();
      if (value) fields[label] = value;
    }
  }

  const name = fields["name"];
  if (!name) {
    return { matchedFormat: false, name: "", phone: null, email: null, lineName: null, message: null };
  }

  return {
    matchedFormat: true,
    name,
    phone: fields["phone"] ?? null,
    email: fields["email"] ?? null,
    lineName: fields["insurance line"] ?? fields["line"] ?? null,
    message: fields["message"] ?? fields["notes"] ?? null,
  };
}

// Found in a full-app review: bodyText previously fell back to the raw,
// untouched HTML string for an HTML-only email (no text/plain part) —
// tags and all — which the structured-format line matcher below can never
// match (a line like "<p>Name: Juan</p>" doesn't start with "Name"), so
// every inquiry from an HTML-only sender was silently misclassified as
// needs_review even when correctly formatted. Not a full HTML parser —
// just enough to turn block-level breaks into newlines and strip tags/
// entities so the "Label: value" per-line format survives extraction.
function htmlToPlainText(html: string): string {
  return html
    // <br> matches with `\b[^>]*` (not a bare `<br\s*\/?>`) because real
    // inbox mail — Outlook's `<br clear=all>`, Apple Mail's `<br
    // class="Apple-interchange-newline">` — routinely carries attributes;
    // a bare-tag-only match silently dropped the newline for those,
    // reintroducing the same misclassification this function exists to fix.
    // The closing block tags never carry attributes in valid HTML, so they
    // stay attribute-free.
    .replace(/<br\b[^>]*>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function createLeadFromInquiry(agencyId: string, subject: string, bodyText: string): Promise<void> {
  const parsed = parseStructuredInquiry(subject, bodyText);
  // Routed through the tenant-scoping layer, not the plain `prisma`
  // client, for both Lead.create calls below — found in a full-app review
  // as the one Lead-creating call site in src/lib that bypassed it.
  // Harmless today (agencyId is always set explicitly), but it defeats
  // tenant-db.ts's "centralized in one data-access layer so it can't be
  // forgotten" guarantee for any future edit to this function.
  const scoped = getScopedPrisma(agencyId);

  if (!parsed.matchedFormat) {
    // Point 5: still create a Lead rather than dropping it — flagged for
    // review, raw body kept as the only record of what came in. Lead.name
    // is required (schema), and there's no name to use, so the subject
    // line (or a fallback) stands in.
    await scoped.lead.create({
      data: {
        agencyId,
        ownerId: null,
        name: subject.trim() || "Website inquiry (unparsed)",
        source: "Website Inquiry (needs review)",
        needsReview: true,
        notes: bodyText.slice(0, 5000) || null,
      },
    });
    return;
  }

  let lineId: string | null = null;
  if (parsed.lineName) {
    // Matched by exact name (case-insensitive), not free text (point 7) —
    // fetched and compared in JS rather than a DB-level case-insensitive
    // filter, since SQLite string equality is case-sensitive by default
    // and Prisma's `mode: "insensitive"` isn't supported on this provider.
    const lines = await scoped.insuranceLine.findMany();
    const matchedLine = lines.find((line) => line.name.trim().toLowerCase() === parsed.lineName!.trim().toLowerCase());
    lineId = matchedLine?.id ?? null;
  }

  // A line that couldn't be matched (missing entirely, or present but not
  // found among the agency's configured lines) gets the same needs_review
  // treatment as an unparseable email (point 7).
  const needsReview = lineId === null;

  await scoped.lead.create({
    data: {
      agencyId,
      ownerId: null,
      name: parsed.name.slice(0, 255),
      phone: parsed.phone,
      email: parsed.email,
      source: "Website Inquiry",
      needsReview,
      lineId,
      notes: parsed.message,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SystemAlert bookkeeping for intake failures (Section 9's error table
// entry for "Email intake can't reach the mailbox" + Section 6's
// EmailIntakeConfig comment tying last_error_* to a SystemAlert row).
// Scoped to this one alert type/agency pair — at most one *unresolved*
// email_intake_failure alert exists per agency at a time.
// ─────────────────────────────────────────────────────────────────────────

async function raiseEmailIntakeAlert(agencyId: string, message: string): Promise<void> {
  const existing = await prisma.systemAlert.findFirst({
    where: { agencyId, type: "email_intake_failure", resolvedAt: null },
  });
  if (existing) return;
  await prisma.systemAlert.create({
    data: { agencyId, type: "email_intake_failure", message },
  });
}

async function resolveEmailIntakeAlert(agencyId: string): Promise<void> {
  await prisma.systemAlert.updateMany({
    where: { agencyId, type: "email_intake_failure", resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

export async function getActiveEmailIntakeAlert(agencyId: string) {
  return prisma.systemAlert.findFirst({
    where: { agencyId, type: "email_intake_failure", resolvedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// IMAP polling (Section 5 points 3-4)
// ─────────────────────────────────────────────────────────────────────────

// Caps stored/displayed IMAP error text and redacts the mailbox password
// if it happens to appear verbatim in it (found in a full-app review: this
// was previously stored and shown raw with no defense at all — low risk in
// practice since ImapFlow's own errors don't echo credentials, but nothing
// stopped a future library change, or an unusual server response, from
// putting it there).
function sanitizeImapError(rawMessage: string, password: string | undefined): string {
  const redacted = password ? rawMessage.split(password).join("[redacted]") : rawMessage;
  return redacted.slice(0, 500);
}

export async function pollMailboxForAgency(agencyId: string): Promise<void> {
  const config = await prisma.emailIntakeConfig.findUnique({ where: { agencyId } });
  if (!config || !config.isEnabled) return;

  let client: ImapFlow | undefined;
  let password: string | undefined;
  try {
    password = decryptSecret(config.encryptedPassword);
    client = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.useSsl,
      auth: { user: config.username, pass: password },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock(config.folder || "INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const uid of uids || []) {
        // Found in a full-app review: this whole loop body previously had
        // no per-message error isolation — one email that threw (a parse
        // failure, a DB error) meant it never got marked \Seen, so every
        // *other* still-unread email in the same poll was abandoned too
        // (the throw skipped the rest of the loop entirely), and since the
        // next poll re-fetches the same unseen messages, that one poison
        // email would silently re-block everything behind it forever. Each
        // message now succeeds or fails independently: a failure here is
        // logged and left unmarked (so it's not silently dropped and stays
        // available for another look), but doesn't stop its neighbors.
        try {
          const message = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          if (!message || !message.source) continue;

          const parsedMail = await simpleParser(message.source);
          const bodyText =
            parsedMail.text ?? (typeof parsedMail.html === "string" ? htmlToPlainText(parsedMail.html) : "") ?? "";
          const subject = parsedMail.subject ?? message.envelope?.subject ?? "";

          await createLeadFromInquiry(agencyId, subject, bodyText);
          // Marks it read so it's never imported twice on the next poll
          // (point 4) — chosen over moving to a "Processed" folder, since a
          // dedicated folder isn't guaranteed to exist across arbitrary IMAP
          // providers and creating one adds a failure mode of its own for no
          // real benefit here.
          await client.messageFlagsAdd([uid], ["\\Seen"], { uid: true });
        } catch (messageError) {
          console.error(`[email-intake] failed to process message uid ${uid} for agency ${agencyId}:`, messageError);
        }
      }
    } finally {
      lock.release();
    }

    await prisma.emailIntakeConfig.update({
      where: { agencyId },
      data: { lastPolledAt: new Date(), lastErrorAt: null, lastErrorMessage: null },
    });
    await resolveEmailIntakeAlert(agencyId);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Unknown IMAP error";
    const message = sanitizeImapError(rawMessage, password);
    await prisma.emailIntakeConfig.update({
      where: { agencyId },
      data: { lastErrorAt: new Date(), lastErrorMessage: message },
    });
    await raiseEmailIntakeAlert(agencyId, message);
  } finally {
    if (client) {
      await client.logout().catch(() => client!.close());
    }
  }
}

// Host-level loop across every agency's mailbox (Section 10's scheduled
// daily-job pattern, just on a 5-minute cadence instead — see
// instrumentation.ts). Each agency's failure is independent: one bad
// mailbox never stops the others from being polled.
export async function pollAllMailboxes(): Promise<void> {
  const configs = await prisma.emailIntakeConfig.findMany({ where: { isEnabled: true } });
  for (const config of configs) {
    await pollMailboxForAgency(config.agencyId).catch((error) => {
      console.error(`[email-intake] poll failed for agency ${config.agencyId}:`, error);
    });
  }
}
