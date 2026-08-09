# Saripda Suite — Insurance Agency CRM Build Plan (Multi-Tenant-Ready, Single-Agency Deployment)

**Baseline v1.4 — August 9, 2026**
This version has been reviewed for internal consistency across all 12 sections — the original four-pass v1.0 review, plus several further rounds addressing gaps found on external review and a round of business-decision follow-ups. Section 12 lists what's still genuinely open (a few draft field lists pending your confirmation, plus a handful of external action items) — everything else in this document is settled and ready to hand to Claude Code.

**Key decisions since the original v1.0 baseline:**
- **Deployment scope**: one installation per agency for now; the multi-tenant schema (`agency_id` everywhere) is kept as forward-compatible groundwork, not an active requirement (Section 2)
- **Manager sub-team scoping**: each Agent reports to one Manager (`User.manager_id`); a Manager sees/edits only their own team, Agency Head sees the whole agency (Section 3/5/6)
- **Policy lifecycle**: added a `draft` status (so long forms like Life's can be saved incrementally) with an explicit Activate action gating the move to `active`, and an explicit Renewal/Payment action (with correct anniversary-date math) for reactivating a `lapsed` or `grace_period` policy — no more ad-hoc status edits (Section 5/6)
- **Travel insurance**: confirmed sold per-trip with a fixed duration, not yearly-renewing — never lapses or enters grace period. Added a `completed` status and a `TravelDetail` table, with `start_date`/`renewal_date` repurposed as the trip's start/end dates for this one category (Section 5/6/11)
- **VUL fund balances**: confirmed manual entry, matching what the plan already assumed — no design change needed
- **Security & compliance**: full-disk encryption on the host, every document drive, and backups to protect PII at rest (Section 8); a required Audit/Activity Log, not optional (Section 5/6); a login security baseline — 10-character minimum, lockout after 5 failed attempts (Section 5/6); a stated data-retention default of nothing auto-deleted, pending confirmation of the legal retention period (Section 5/12)
- **Bootstrapping**: a defined first step for creating the very first Super Admin account, before any other login exists (Section 5/10)
- **Tech stack**: Auth.js/NextAuth only — Lucia dropped as an option, since it's no longer a maintained library (Section 7)
- **Minor tightening**: `RecordLock` unique constraint, `Policy.lead_id` nullable, mailbox poll interval fixed at 5 minutes, and "what counts as a sale" resolved by the Activate action's payment requirement
- Section 11's Auto/Property/Fire/Health/HMO/Travel minimum-required-info fields are industry-typical drafts pending your confirmation

Future changes should bump this marker (v1.5, etc.) so it's clear which version was actually built against.

## 1. Purpose
A multi-tenant-*capable* lead-to-sale tracking app that multiple **separate insurance agencies** can each use in isolation. Each agency sells one or more insurance lines (e.g. Life, Auto, Property/Fire, Health/HMO, Travel) and has its own users, leads, policies, and metrics — completely walled off from other agencies' data. (Section 2 has the current deployment decision: one agency per installation for now, with the multi-tenant data model kept as groundwork for a possible future shared install.)

Roles within each agency:
- **Sales Agent** — works their own leads and policies
- **Sales Manager** — sees their assigned team's leads/sales, coaches performance (Section 3 has the sub-team scoping details)
- **Agency Head** — sees the whole agency, manages users, sets targets

## 2. Multi-Tenancy Model
Every agency is a **tenant**. All data (users, leads, policies) is scoped to `agency_id`.

| Approach | Description | When to use |
|---|---|---|
| **Shared DB, row-level isolation** (recommended for MVP) | One database, every table has `agency_id`, every query filters by it | Simpler to build/deploy, fine for dozens–hundreds of agencies |
| Schema-per-tenant | Separate DB schema per agency | Better isolation, more ops overhead — overkill for MVP |

**Recommendation:** shared DB + `agency_id` row-level isolation, enforced in application code (every query scoped by the logged-in user's `agency_id`, ideally centralized in one data-access layer so it can't be forgotten on a new query).

A **Super Admin** role (you) sits outside the three agency roles and manually onboards new agencies — no self-serve signup, no billing/subscription logic for this phase.

**Decision: one installation per agency, for now.** The multi-tenant schema above (`agency_id` on every table) is kept as forward-compatible groundwork, but the current deployment target is a single agency per install — matching the LAN-only, copy-paste-per-office model in Section 8. In practice this means the Super Admin's Agency Onboarding flow (Section 5) gets exercised once per install — create the one agency and its Agency Head — rather than repeatedly onboarding a growing roster of separate agencies; nothing is artificially restricted to exactly one agency in the schema or UI, so a genuine shared multi-agency install remains possible later without a rebuild, but concerns that only matter at that scale (remote/non-co-located Super Admin access, cross-install reporting, etc.) are out of scope until it's an actual requirement.

## 3. Roles & Permissions (within a single agency)

| Capability | Agent | Manager | Agency Head |
|---|---|---|---|
| View own leads/sales | ✅ | ✅ | ✅ |
| View other agents' leads/sales | ❌ | ✅ (own team only) | ✅ (whole agency) |
| Create/edit/delete own leads | ✅ | ✅ | ✅ |
| Reassign leads between agents | ❌ | ✅ (within own team) | ✅ (anyone) |
| Edit any agent's records | ❌ | ✅ (own team only) | ✅ (whole agency) |
| View team/agency-wide metrics/dashboards | ❌ | ✅ (own team) | ✅ (whole agency) |
| Manage users/roles in agency | ❌ | ❌ | ✅ |
| Assign agents to managers | ❌ | ❌ | ✅ |
| Configure agency's insurance lines/products | ❌ | ❌ | ✅ |
| Set targets/quotas | ❌ | ✅ (own team) | ✅ (whole agency) |
| Cross-agency visibility | ❌ | ❌ | ❌ (Super Admin only) |

**Sub-team scoping (confirmed)**: each Agent is assigned to exactly one Manager (`User.manager_id`, Section 6) by the Agency Head. A Manager's visibility, edit rights, and lead-reassignment rights are limited to their own assigned agents — only the Agency Head sees and manages the whole agency. An Agent not yet assigned to a Manager sits in an unassigned pool visible only to the Agency Head, mirroring the Lead unassigned-pool pattern (Section 5) — these are two separate "unassigned" concepts (agents without a manager vs. leads without an owner), not the same queue.

## 4. Insurance Lines & Products
Insurance lines are **configurable per agency** — an agency picks its own name for each line (e.g. "Life", "Auto", or something more marketing-y like "Family Protection Plan"). But since forms, required fields, and lapsing rules genuinely differ by *type* of insurance (Section 6, 9, 11), every line also carries a fixed **category** (`life | auto | property | health | travel | other`) alongside its free-text name. The category is what the app's logic actually keys off of — an agency renaming their life line doesn't change which forms or rules apply, since those are wired to `category`, never to the display name.

Field requirements differ a lot by category — life insurance needs detailed insured/owner/beneficiary data, while auto or property needs different documentation. Rather than one generic `metadata` blob, each category gets its **own requirement checklist and, where the data is structured (like life), its own dedicated tables** (Section 6 and Section 11).

## 5. Core Features (MVP)

### Data Consistency Across PCs
All PCs on the network are just browsers pointing at the one app running on the host PC — there's a single SQLite database on the host, not a separate copy per machine, so everyone is always reading/writing the same data. The only thing to design for: a page someone already has open won't auto-update if someone else changes that data elsewhere. Two options, in increasing order of effort:
- **Refetch on focus/interval** (simplest): re-fetch the current view's data when the browser tab regains focus, or every 30–60 seconds — good enough for a small office team, no extra infrastructure, and also how other users will see a record's lock status (Record Locking, below) without needing a full refresh
- **Live updates via WebSockets/SSE** (optional, later): push changes to open tabs instantly (e.g. a manager sees a new lead appear, or a lock release, without refreshing) — nice-to-have, not needed for MVP

**On overhead:** for an office-sized team (think single or low double digits of concurrent users), 30–60 second polling is negligible — well under 1 request/second total against the host, each a small, indexed lookup, a few KB of JSON. It won't be noticeable on the host CPU or the LAN. To keep it that way as a matter of design (not just current scale): poll for small targeted status (e.g. "is this record locked, and by whom") rather than re-fetching whole lists, and pause polling when the browser tab isn't focused/visible.

### Record Locking (Check-Out / Check-In)
To prevent two people editing the same Lead or Policy at once:
- When a user opens a record for editing, it's **checked out** to them — anyone else viewing that record sees it as read-only with a "Currently being edited by [name], since [time]" notice, and their edit controls are disabled
- The record is **checked in** automatically when the editor saves or navigates away/closes the edit form
- **Auto-release on timeout**: if a lock sits idle too long (e.g. 15 minutes with no activity — covers someone closing their browser without properly exiting the form), it's automatically released so the record doesn't get stuck locked forever
- **Manual override**: a Manager can force-release a stuck lock on their own team's records; Agency Head can do it for any record in the agency — in case the timeout hasn't hit yet and someone genuinely needs in (e.g. the original editor is on leave)
- Viewing a record (not editing) never requires a lock — only entering edit mode does

### Agency Onboarding (Super Admin — you)
- No self-serve signup. You manually create each new agency and its initial Agency Head account. Under the current one-install-per-agency deployment (Section 2), this happens once per install rather than repeatedly — but it's not hard-restricted to one agency, in case that changes later
- Agency Head then creates accounts for Managers/Agents (Section 5's Users feature covers exactly how — no outbound email is involved) and configures insurance lines

### System Configuration (Super Admin)
- **Bootstrapping the Super Admin account**: nobody exists yet to create the first login, so the first-run wizard's very first step (before anything else on this page) is the person setting up the machine creating the Super Admin account directly — their own email + password, no temporary-password/relay step needed since they're setting it for themselves
- A settings page where you can specify/update the host PC or laptop's IP address (and port, if needed)
- The app uses this stored value to display the LAN URL (e.g. for a "share this link with your team" screen) rather than it being hardcoded — useful since the host machine or its IP may change over time
- Changing it here doesn't reconfigure the network itself (that's still done at the OS/router level per Section 8) — it just tells the app what address to advertise to users
- **Document storage location is required, and must be on a different disk than the app/database.** On **first run**, the app detects which disk the app itself is installed on, then requires the Super Admin to pick a document storage path on a *different* physical disk or mount. **Default recommendation: a second internal drive** (fastest, most reliable) — an external/USB drive or a network path (NAS or another PC's shared folder) both also work if that's what's available. The app won't finish setup until a valid separate-disk path is chosen
- **How "different disk" is checked**: compare the drive/volume the app is running from against the volume the chosen document path resolves to — on Windows this is comparing drive letters (or volume GUIDs, since a network path won't share one at all); on Mac/Linux this is comparing the filesystem's device ID (`st_dev`) for each path. A network path always passes this check automatically, since it's never the same physical disk as the host
- **Adding a location when storage fills up**: rather than just repointing the one path (which would strand already-saved documents), the Super Admin can **add a new storage location** from this page — another internal drive, an external drive, or a network path — and mark it as the active target for new uploads. Existing documents keep working from wherever they already are; only new uploads go to the newly added location. A simple disk-usage indicator per location (e.g. "Internal Drive D: — 92% full") flags when it's time to add one

### Storage Locations & Growth (Documents Only — Not the Database)
Document storage isn't a single fixed path — it's a small list of **storage locations** (System Configuration, above), so a new one can be added without touching or migrating what's already saved. The one rule that matters most:
- **SQLite database file → must stay on the app's own disk, never a network share, and is separate from all of this.** SQLite relies on OS-level file locking to stay consistent, and that locking is unreliable over SMB/network shares — it risks database corruption or write failures under concurrent access, which is exactly this app's normal usage (multiple agents/managers hitting it at once). `agency-crm.db` always stays on the disk the app itself runs from
- **If the database itself ever needs more room** (unlikely on its own — leads/policy records stay small; it's the documents that grow) — a bigger local disk for the app itself, or migrating to Postgres on a proper server (Section 8's future path), is the right fix, not a network share
- **Net effect**: the app's own disk mainly needs to be big enough for the OS + app + database (small, stays small); documents can keep growing across an expanding set of drives — internal or network — without ever touching the app's disk or requiring a migration of old files

### Leads
- Add/edit lead: name, contact info, source, insurance line/product interest, status, notes, follow-up date
- Pipeline: New → Contacted → Quoted → Negotiating → Won / Lost
- Follow-up reminders list
- **Unassigned/needs-review queue**: leads with no owner yet (from Website Inquiry Intake, below) and leads flagged `needs_review` are visible in a dedicated view for every Manager and the Agency Head, so nothing from the public site quietly sits unassigned or unnoticed — any Manager can claim one of these into their own team (sub-team scoping, Section 3, only restricts visibility into leads *already* assigned to another team, not this shared unassigned pool)

### Website Inquiry Intake (Client-Facing Site → Leads)
A separate client/customer-facing site (built later, publicly reachable on the internet — unlike the LAN-only CRM) will collect inquiries. Since the CRM host deliberately has no inbound internet exposure (Section 8), inquiries reach it via **email polling** rather than a direct API push:

1. The public site's inquiry form sends a **structured email** (fixed field labels, not free text) to a dedicated inbox — e.g. `inquiries@[agency-domain]` — using any normal outbound email/SMTP service on the public site's side
2. Each agency configures its **own inbox credentials** (IMAP host, port, username, app password, folder) under Agency settings — this keeps multi-tenant isolation intact, since each agency's inquiries land in that agency's own mailbox and nowhere near another agency's data. **Initially this will be a Gmail address** (Gmail requires an "App Password," generated from the Google Account with 2-Step Verification turned on, rather than the normal login password, for IMAP access). The config is provider-agnostic, though — any IMAP-accessible inbox works, so an agency can later switch to an address on the company's own domain (e.g. via Google Workspace, Microsoft 365, or standard cPanel/business email hosting) just by updating the IMAP host/credentials — no code change needed
3. The CRM host **polls each configured mailbox every 5 minutes** over IMAP — an *outbound* connection the host initiates, so no firewall/router change is ever needed, unlike a webhook that would require an inbound port. Five minutes keeps leads reasonably timely without hammering the mail server; it's a fixed interval for MVP rather than a per-agency setting, since nothing suggests any agency needs something different
4. Each new (unread) email is parsed using the structured field labels into a new **Lead**, with `source = "Website Inquiry"`, then marked processed (moved to a "Processed" folder or flagged) so it's never imported twice
5. **If an email doesn't match the expected structured format** (e.g. someone replies directly to that inbox, or the site template changes), it's still created as a Lead — flagged `"Website Inquiry (needs review)"` with the raw email body in notes — rather than silently dropped, so nothing gets lost even when parsing fails
6. New leads from this intake land in an **unassigned pool** by default; a Manager assigns them to one of their own team's agents, or Agency Head to anyone (or a simple round-robin auto-assignment can be added later if the team wants it)
7. **Matching the insurance line**: since each agency names its own `InsuranceLine`s (Section 4), the structured email needs to reference one unambiguously — the public site's form should send the exact line identifier the agency configured (e.g. a dropdown populated from that agency's line list, not free text) so the parser can match it directly. If a line can't be matched, the Lead is still created with `line_id` empty and flagged `needs_review`, same as an unparseable email

### Sales / Policies
- Convert a won lead into a policy: line/product, premium, commission, start date, renewal date, status (draft/active/grace_period/lapsed/cancelled/completed — `completed` is Travel-only, below)
- A new policy starts as `draft` — this lets an agent save partial progress on the long Life insurance form (Section 11) across multiple sessions without losing work; record locking (above) applies to a `draft` policy exactly like any other
- **Activating a policy** is an explicit action, separate from just editing fields: it's only available once the line's **minimum required information** (Section 11) is filled in and required documents (e.g. Proof of Payment) are attached, and it's what actually moves `status` from `draft` to `active`
- Document upload/attachment support (Proof of Payment, valid ID, etc.) — usable while still in `draft`

### Policy Renewal & Lapsing Rules
A scheduled background job (runs daily, similar in spirit to the mailbox poller and disk-space check) evaluates every `active` or `grace_period` policy and updates status automatically — the specific rule depends on the policy's type:

| Policy type | Behavior when `renewal_date` passes |
|---|---|
| Non-life — **Auto, Property/Fire, Health/HMO** (yearly renewal) | Marked **lapsed** immediately. Coverage is not enforceable during the lapsed period; the customer can renew anytime, which reactivates it going forward (not retroactively) |
| Non-life — **Travel** (per-trip, fixed duration — confirmed) | Not lapsed at all. `start_date`/`renewal_date` hold the trip's start/end dates rather than an annual cycle (Section 6) — once the end date passes, the daily job simply marks it **completed**. No grace period, no lapsing, no renewal: a customer traveling again buys a brand-new policy, never a renewal of the old one |
| Life — **Term/Traditional** | Same as non-life: marked **lapsed** immediately |
| Life — **Non-term, non-VUL** (e.g. whole life, endowment) | Enters a **30-day grace period** (`grace_period` status) rather than lapsing immediately. If payment is made within that window, it returns to `active` with a new renewal date. If not, it becomes **lapsed** at the end of the 30 days |
| Life — **VUL (Variable Universal Life)** | Does **not** lapse based on `renewal_date` at all. It stays `active` as long as the investment account has funds; it only becomes `lapsed` once the fund balance reaches zero. Since actual fund performance isn't tracked by this app, the balance is a figure an agent/admin updates periodically (Section 6) rather than something computed automatically |

**Daily job scope, in detail**: `active` non-Travel policies are checked against `renewal_date` and lapsed/enter grace period per the rules above; `active` **Travel** policies are checked against their trip end date (also stored in `renewal_date`, Section 6) and moved straight to `completed` — no lapsing, no grace period; `grace_period` policies are checked against `grace_period_ends_at` and moved to `lapsed` if that deadline passes without a recorded renewal. All three checks run in the same daily job, not separate processes.

Which rule applies is driven by a `life_policy_type` field on the **Product** (Section 6) — set once per product when the Agency Head configures their Life products, not re-entered per policy.

A policy entering `grace_period` is only useful if someone actually follows up during that window — otherwise the 30 days just quietly expire into a lapse anyway. So a policy that enters `grace_period` appears in the same **follow-up/reminders view** as Lead follow-ups (Section 5's Leads feature), assigned to that policy's owning agent, so collecting payment before it lapses is an active task rather than something only visible by digging into policy status.

### Recording a Renewal / Payment
Reactivating a `lapsed` or `grace_period` policy is a dedicated action, not a raw edit of the `status` field — this keeps the required paperwork enforced every time a policy comes back to `active`, whether that's a same-day non-life renewal or a payment collected near the end of a life grace period. Triggered by the owning agent (or Manager/Head) from the policy view:
1. Upload a new Proof of Payment document (required — same upload rules as this section's document handling)
2. The app sets `status = active` and clears `grace_period_ends_at` if it was set. The new `renewal_date` is one year forward (every currently-defined line renews yearly, per the table above) — but computed from **which** date depends on where the policy is coming from:
   - From `grace_period`: one year forward from the **original** `renewal_date`, so a payment made partway through the 30-day grace window doesn't shift the policy's yearly anniversary
   - From `lapsed`: one year forward from **today**, matching the "reactivates going forward, not retroactively" rule above — there's no anniversary left to preserve once it's actually lapsed
3. The action is written to the `ActivityLog` (below) so there's a record of who renewed the policy and when

`cancelled` policies are not reactivated through this action — cancellation is treated as final; a customer who wants coverage again gets a new policy. VUL policies also don't use this action for lapsing/reactivation, since they aren't governed by `renewal_date` at all — only the manual `vul_fund_balance` update (Section 6) applies to them. **Travel policies never use this action either**: per-trip coverage (above) doesn't lapse or renew, so a customer traveling again gets an entirely new policy, not a renewal of the old one.

### Upload Limits & Image Sizing
- **Accepted file types**: PDF, JPG/JPEG, PNG (covers scanned documents and phone photos of IDs/receipts)
- **Max file size**: 5 MB per file — comfortably covers a photographed document while keeping storage/backup size predictable, especially given the portable/copy-paste deployment where the documents folder travels with the app
- **Image footprint recommendation**: resize/compress images client-side (in the browser, before upload) to a max dimension of **~2000px on the longest side** at **~80% JPEG quality**. That's well past what's needed to read text on an ID or receipt clearly — most compressed results land in the **200 KB – 1 MB range** per image, versus 4–8+ MB straight off a modern phone camera. PDFs (already compact) can skip this resizing step
- **Why it matters here specifically**: with SQLite for the app's own data and dedicated storage-location drives for documents (Sections 6–8), keeping individual files small keeps those drives — and the regular backup of them — fast and predictable, even as hundreds of policies' documents accumulate

### How Documents Are Saved
1. Browser compresses the image (if applicable) per the limits above, then uploads it to the backend
2. Backend looks up the current **active** `StorageLocation` (Section 6), generates a unique filename (the `Document` record's own ID/UUID + original extension — never the raw filename the user uploaded, to avoid collisions or path issues), and writes the file under that location's path, scoped by agency and policy:
   ```
   {storage_location.path}/
     {agency_id}/
       {policy_id}/
         {document_id}.{ext}
   ```
3. A row is written to the `Document` table (Section 6) storing which `StorageLocation` it's on, the relative path within it, type, size, uploader, and timestamp — the database is the source of truth for *what and where* a file is; the drive is just where the bytes live
4. **Serving files back**: the backend never exposes any storage location as a raw static directory. Every file request goes through an authenticated route that checks the requesting user's `agency_id` (and role/policy-ownership, following `Document.policy_id`) against the `Document` row, then reads from whichever `StorageLocation` that document is actually on (old or newly active) — this stops one agency's user from ever reaching another agency's files even by guessing a URL
5. Because the database always knows which location holds which file, adding a new `StorageLocation` when a drive fills up never breaks access to documents already saved on an earlier one — nothing needs to be moved

### Metrics & Dashboards
- Agent: my pipeline, my conversion rate, my sales this month, follow-ups due (including my policies in `grace_period`, per Section 5)
- Manager/Head: leaderboard by agent, conversion rate by insurance line, revenue/commission totals, pipeline funnel, trends over time, **policies by status** (draft / active / grace period / lapsed / cancelled / completed) so a lapse trend or a backlog of uncollected grace-period payments is visible, not just per agent. A Manager's view is scoped to their own assigned agents (Section 3); Agency Head sees the whole agency. Revenue/commission totals count `active` status and later — a `draft` policy isn't a completed sale yet. (This settles Section 12's original "what counts as a sale" question: since the Activate action, above, already requires Proof of Payment before a policy can leave `draft`, "policy issued" and "premium collected" are the same moment for MVP — a sale counts the instant status reaches `active`.)
- Filters: date range, insurance line, agent, policy status

### Audit / Activity Log
Given how much sensitive PII this app holds (TIN, SSS numbers, valid ID numbers, addresses — Section 11) and that compliance requirements are still being confirmed (Section 12), a basic audit trail is required, not a nice-to-have polish item. Every create/update/delete on a Lead, Policy, or Document, every user-management action, and every login is written to `ActivityLog` (Section 6) with who did it, when, and what changed. Agency Head can view their agency's log; Super Admin can view host-level events. No dedicated dashboard is needed for MVP — a simple filterable list (by record, by user, by date range) is enough.

**Data retention default**: for MVP, nothing is ever automatically deleted — Leads, Policies, Documents, and `ActivityLog` entries are kept indefinitely (deactivating a User, above, already handles the "someone left" case without erasing their history). This is a deliberate default while the actual legal retention/right-to-deletion period under the Philippine Data Privacy Act is still being confirmed (Section 12) — nothing is destroyed in the meantime, so no data is lost to a wrong guess. If a specific retention or deletion policy is set later, it becomes an explicit, deliberate action (a Super Admin tool or scheduled job), never a silent background purge.

### Users
- Agency-scoped accounts, roles: Agent / Manager / Head (+ Super Admin outside agencies)
- Agency Head manages users within their own agency only
- **Account creation ("inviting")**: no outbound-email capability exists in this app (the only email integration is *inbound* IMAP polling for lead intake, Section 5 — there's no SMTP-sending setup). So "inviting" a Manager/Agent is the Agency Head directly creating their account and setting a **temporary password**, shown once on screen for the Agency Head to relay to that person directly (in person, chat, etc.) — the new user is prompted to change it on first login. A "send a real invite email" flow can be added later if the agency sets up outbound SMTP, but it's not assumed by default. The Super Admin creating an agency's first Agency Head account (Agency Onboarding, above) works exactly the same way — temporary password, relayed directly, changed on first login
- **Password reset**: same reasoning — no assumed email deliverability, so a self-service "forgot password" email link isn't the default. Instead, an **Agency Head can reset any user's password** in their agency (issuing a new temporary password the same way as account creation); Super Admin can do the same for Agency Head accounts
- **Deactivation**: an Agency Head can deactivate a user who leaves (`is_active = false`) rather than deleting them — their historical leads/policies/activity stay intact and attributed to them; a Manager/Agency Head reassigns their **open** leads/policies to someone active. A deactivated user can't log in but their name still displays correctly on old records
- **Manager assignment**: the Agency Head assigns each Agent to exactly one Manager (`User.manager_id`, Section 6), reassignable anytime — e.g. when a Manager leaves or the team structure changes. An Agent not yet assigned sits in an unassigned pool visible only to the Agency Head (Section 3)
- **Search**: a simple text search (by name, phone, or email) across Leads and Policies, scoped to what that user's role can already see — useful once lead volume grows past what filters alone make easy to scan
- **Login security baseline**: passwords (temporary or user-chosen) must be at least 10 characters — length rather than forced complexity rules, per current password-guidance best practice (NIST 800-63B). After 5 consecutive failed login attempts on an account, that account is locked out for 15 minutes regardless of whether the next attempt would've been correct. This is a per-account lockout, not IP-based (the app is LAN-only, so IP-based limiting doesn't add much) — every failed attempt and lockout is written to `ActivityLog` (below)

## 6. Suggested Data Model

```
Agency
  id, name, created_at

SystemConfig
  id, host_ip, host_port, setup_completed_at, updated_at
  # single-row table (or key-value store); Super Admin editable via System Configuration page
  # app blocks normal use until setup_completed_at is set (requires the Super Admin
  # account to exist and at least one active StorageLocation)

StorageLocation
  id, path, label (e.g. "Internal Drive D:", "NAS - Office"),
  is_active (bool, whether new uploads go here),
  is_reachable (bool), last_checked_at, added_at
  # multiple rows allowed; new locations added via System Configuration as storage fills up.
  # Each is validated on add to resolve to a disk/volume different from the app's own.
  # Exactly one is_active=true at a time (the current target for new uploads);
  # older, now-inactive locations stay readable for their existing documents.
  # is_reachable + last_checked_at updated by the periodic disk-space check
  # (Section 9) — what the System Health page actually reads to show status

RestartEvent
  id, restarted_at, reason (health_check_failed|manual|crash)
  # logged by the process supervisor (Section 9) each time it restarts the app;
  # the System Health page's "last few restart events" reads this table, and
  # restart-loop protection counts recent rows here to decide when to stop

SystemAlert
  id, agency_id (nullable — null for host-level alerts like disk-full or a
    restart loop; set for agency-scoped ones like an unreachable mailbox),
  type (storage_full|storage_unreachable|email_intake_failure|restart_loop|other),
  message, created_at, resolved_at (nullable)
  # backs every "persistent alert" mentioned in Section 9's error table —
  # host-level alerts surface on the Super Admin's System Health page,
  # agency-scoped ones (e.g. email intake) surface on that agency's settings

User
  id, agency_id (nullable for Super Admin), name, email, password_hash,
  role (super_admin|agent|manager|head), is_active (bool), created_at,
  failed_login_attempts (int, default 0), locked_until (nullable timestamp),
  manager_id (nullable — FK to another User; only meaningful when role=agent;
    which Manager this Agent reports to, per Section 3's sub-team scoping)
  # password_hash via bcrypt/argon2, never stored plain. is_active supports
  # deactivating someone who leaves without deleting their historical records.
  # failed_login_attempts/locked_until back the login lockout rule (Section 5's
  # Users feature) — reset failed_login_attempts to 0 on any successful login.
  # manager_id null means "unassigned", visible only to the Agency Head

InsuranceLine
  id, agency_id, name (agency's own label, e.g. "Life", "Family Protection Plan"),
  category (life|auto|property|health|travel|other), created_at
  # `name` is whatever the agency calls it (fully free text, per Section 4);
  # `category` is the fixed set the app has built-in logic for — it decides
  # which dedicated tables attach (LifeInsured/LifeOwner/Beneficiary for
  # "life", AutoOwner/Vehicle for "auto", TravelDetail for "travel"), which
  # Minimum Required Info
  # checklist applies (Section 11), and which renewal/lapsing rule applies
  # (Section 5). An agency renaming their line doesn't change any of this,
  # since the app logic keys off `category`, never off `name`. "other" is
  # for a custom line with no dedicated fields beyond the generic ones.

Product
  id, agency_id, line_id, name, description,
  life_policy_type (term|non_term_traditional|vul, nullable — only meaningful
    when this product's InsuranceLine.category = "life"),
  created_at
  # drives the renewal/lapsing rule a Life policy follows (Section 5's
  # Policy Renewal & Lapsing Rules); irrelevant/null for non-Life products,
  # since all non-life categories follow the same immediate-lapse rule

EmailIntakeConfig
  id, agency_id, imap_host, imap_port, username, encrypted_password,
  folder, use_ssl, is_enabled, last_polled_at,
  last_error_at, last_error_message (nullable — cleared on next successful poll)
  # one per agency (an agency may skip this if they don't want website intake).
  # Password stored encrypted at rest, never shown again after entry.
  # Provider-agnostic: works with any IMAP inbox. Initial default is Gmail
  # (imap.gmail.com, App Password required); a company-domain email
  # (Google Workspace, Microsoft 365, standard hosting) is just a different
  # imap_host/username — no schema or code change needed to switch later.
  # last_error_at/last_error_message + a SystemAlert row (below) is what
  # backs the "can't check inbox" alert described in Section 9

Lead
  id, agency_id, owner_id (User, nullable — null means "unassigned pool"),
  name, phone, email, source (e.g. "Website Inquiry", "Referral", "Manual"),
  needs_review (bool, true if an inquiry email didn't match the expected format),
  line_id, product_id (nullable),
  status (new|contacted|quoted|negotiating|won|lost),
  notes, next_follow_up_date, created_at, updated_at

Policy
  id, agency_id, lead_id (nullable — a policy doesn't have to originate from
    a tracked Lead, e.g. a walk-in renewal or a migrated legacy policy),
  owner_id (User), line_id, product_id,
  premium, commission, start_date, renewal_date,
  status (draft|active|grace_period|lapsed|cancelled|completed),
  # created as `draft` (Section 5) so long forms like Life's can be saved
  # incrementally; moves to `active` only via the explicit Activate action.
  # `completed` is Travel-only — set by the daily job once a Travel policy's
  # trip end date (stored in `renewal_date`, see below) passes; no other
  # category ever reaches this status
  # For Travel-category policies specifically, start_date/renewal_date hold the
  # trip's start/end dates rather than an annual renewal cycle (Section 5) —
  # reusing the same two fields avoids a category-specific schema branch
  grace_period_ends_at (nullable — set when entering grace_period, per Section 5),
  vul_fund_balance, vul_fund_balance_updated_at (both nullable — VUL Life
    products only; manually updated by an agent/admin, since actual fund
    performance isn't tracked here),
  proof_of_payment_doc_id -> Document (nullable until uploaded),
  metadata (JSON, line-specific extras not worth a dedicated table)
  # proof_of_payment_doc_id is a convenience pointer to which of this policy's
  # Document rows (below) is specifically the proof of payment, so the UI can
  # check "is this filled in yet" without filtering Document by type each time

Document
  id, agency_id, policy_id, storage_location_id -> StorageLocation,
  type (proof_of_payment|valid_id|other),
  file_path (relative to that storage location's path, e.g. "{agency_id}/{policy_id}/{id}.ext"),
  file_size_bytes, uploaded_by (User), uploaded_at
  # storage_location_id + file_path together locate the actual bytes, so documents
  # keep working even after a newer StorageLocation becomes the active one

RecordLock
  id, agency_id, record_type (lead|policy), record_id,
  locked_by (User), locked_at, last_activity_at
  # one row per currently-checked-out record; deleted on check-in or timeout expiry
  # unique constraint on (record_type, record_id) so two near-simultaneous
  # check-out attempts can't both succeed — the second fails and the requester
  # sees the "being edited by" message instead of silently overwriting the lock

--- Life insurance specific (only attached when the Policy's InsuranceLine.category = "life") ---

Person
  # Reusable shape for both Insured and Owner — most fields overlap
  id, first_name, middle_name, last_name, height, weight_lbs,
  present_address, permanent_address, mobile_no, telephone_no,
  religion, civil_status, birthdate, birthplace, gender_at_birth,
  weight_at_birth,
  father_status (alive|deceased), father_age_or_age_at_death,
  mother_status (alive|deceased), mother_age_or_age_at_death,
  brother_ages (up to 3, nullable slots),
  sister_ages (up to 3, nullable slots)
  # age is computed from birthdate, not stored

LifeInsured (extends Person)
  id, person_id -> Person, policy_id -> Policy,
  is_smoker (bool)

LifeOwner (extends Person, adds employment/ID fields)
  id, person_id -> Person, policy_id -> Policy,
  is_same_as_insured (bool),  # common case: owner buys for self
  employer_business_name, employer_business_address, nature_of_business,
  occupation, total_years_employment,
  tin_no, sss_no,
  valid_id_type, valid_id_no, valid_id_expiration_date
  # when is_same_as_insured is true, person_id should point to the SAME Person
  # row as LifeInsured.person_id (not a duplicate copy) — the form just shows
  # the employment/ID fields as additional, without re-asking the shared fields

Beneficiary
  id, policy_id -> Policy,
  beneficiary_type (primary|contingent),  # up to 3 primary, up to 2 contingent
  slot_number,
  first_name, middle_name, last_name, permanent_address,
  birthdate, mobile_no, relationship_to_insured
  # age is computed from birthdate
  # named beneficiary_type (not "category") to avoid collision with
  # InsuranceLine.category, which means something entirely different

--- Auto insurance specific (only attached when the Policy's InsuranceLine.category = "auto") ---

AutoOwner
  id, policy_id -> Policy,
  complete_name

Vehicle
  id, policy_id -> Policy,
  car_maker, car_model, year_released

--- Travel insurance specific (only attached when the Policy's InsuranceLine.category = "travel") ---

TravelDetail
  id, policy_id -> Policy,
  traveler_name, passport_no, destination, purpose_of_travel,
  coverage_type (medical|baggage|trip_cancellation|comprehensive)
  # Policy.start_date / renewal_date double as the trip's start/end dates for
  # Travel policies (Section 5) — no separate date fields needed here

ActivityLog
  id, agency_id, lead_id or policy_id (nullable — Document actions log against
    their parent policy_id, since Document has no column of its own here;
    login/user-management events set neither), user_id, action, timestamp, note
  # required, not optional (Section 5's Audit / Activity Log) — this is the
  # audit trail for a data model holding TIN, SSS No., and valid ID numbers
```

Every tenant-scoped table (Lead, Policy, Document, User, InsuranceLine, etc.) carries — directly or via its parent Policy — `agency_id`; this is the tenant isolation boundary. **`SystemConfig`, `StorageLocation`, and `RestartEvent` are the exception**: they're host-level infrastructure shared across every agency on this one installation (there's one set of storage drives, one host IP, and one app process, not one per agency), so they intentionally have no `agency_id`. `SystemAlert` sits in between — `agency_id` is nullable there specifically because it holds both host-level and agency-scoped alerts.

## 7. Suggested Tech Stack
Given the copy-and-paste deployment goal (Section 8), the stack is chosen to avoid anything that needs its own install/service on the target machine:

- **Frontend**: React + Vite + TypeScript, Tailwind CSS
- **Backend**: Next.js (App Router) API routes, or Node.js + Express
- **Database**: **SQLite** via Prisma ORM — the entire database is a single file (e.g. `data/agency-crm.db`) that lives inside the app folder, so copying the folder copies the database too. No separate database server to install or configure. (Postgres remains a fine upgrade path later if the app ever needs to run on a real server instead of one PC — Prisma makes that swap straightforward.)
- **File storage**: Document uploads (Proof of Payment, valid ID) stored on whichever disk each `StorageLocation` (Section 6) points to — **not** inside the app folder itself, since Sections 5 and 8 require documents to live on a separate disk from the app/database. Client-side image compression (e.g. `browser-image-compression`) applied before upload per Section 5's limits
- **Auth**: Auth.js/NextAuth — session carries `agency_id` and `role`. (Not Lucia: it was archived as a distributable package by its maintainer, who now recommends hand-rolling sessions from its guide instead — not worth the dependency risk here.)
- **Secrets**: an app-level encryption key (for `EmailIntakeConfig.encrypted_password` and the session/auth secret) generated on first run and stored in a local `.env` file inside the app folder — not committed to any repo, and it travels with the app folder on a copy-paste move like everything else. Losing this file means re-entering mailbox credentials, so it's worth including in the backup routine (Section 8)
- **Charts**: Recharts

## 8. Deployment (Self-Hosted, LAN-Accessible, Copy-Paste Portable)
Initial deployment target is a single machine on the office's local network (not the public internet) — e.g. a spare PC, mini PC, or NAS box that stays on. Deployment should be as simple as copying the app folder to another PC and starting it — no Docker, no separate database install.

- **Pre-deployment hardware requirement**: before go-live, a **secondary drive must be in place** — default and recommended is a second internal drive on the host PC (fastest, most reliable); a network-accessible drive/NAS also works if that's what's available. This is where documents will be stored (Section 5) and it's a hard prerequisite of the first-run setup wizard. If it fills up later, additional locations (another internal drive, external drive, or network path) can be added without downtime — see Section 5
- **Protecting PII at rest**: the database and documents both hold sensitive PII (TIN, SSS No., valid ID numbers, addresses — Section 11), and the whole point of this deployment is that both live on plain files that can be copied. Rather than adding database-level encryption (e.g. SQLCipher), which would complicate the SQLite/Prisma setup in Section 7 for a LAN-only single-PC install, the practical mitigation is **full-disk encryption on every drive involved**: the host machine's drive (BitLocker on Windows, FileVault/LUKS elsewhere) and every document `StorageLocation` drive. This is a one-time OS-level setup step per drive, not an app feature, and it means a lost or stolen drive doesn't hand over readable PII
- **Packaging**: build the app as a self-contained folder — app code + a bundled/portable Node.js runtime, all inside one directory. **Note if using Next.js** (Section 7): its `output: 'standalone'` build mode produces exactly this kind of self-contained folder (server + minimal dependencies, run with `node server.js`) and is the right fit here; the `pkg`/`nexe` single-executable route mentioned as a "zero prerequisites" option is really only compatible with a plain Node/Express backend, not Next.js — either approach still satisfies the copy-paste-a-folder goal, just via a folder-with-a-start-script rather than one literal `.exe`. The SQLite database file lives inside this folder. Documents live on the required secondary drive(s) (Section 5), separate from this folder
- **Moving to a new PC**: stop the app, copy the app folder (containing code + database) to the new machine, run the start script, and re-point (or physically move) each storage location's drive to the new host — the database moves with the app folder; each documents drive moves with itself. Enable full-disk encryption on the new host's drive (and any newly added storage-location drives) *before* copying data onto them, not after
- **Network access**: other computers on the same LAN reach it via the host machine's static IP (e.g. `http://192.168.1.50:3000`) — the host PC will be configured with a static IP (either set directly on the machine or reserved for it in the router's DHCP settings) so the address never changes on reboot. That same IP is entered into the app's System Configuration page (Section 5) so the app can display/share the correct LAN URL
- **HTTPS**: not required for LAN-only use; plain HTTP is fine on a trusted internal network. If remote/internet access is added later, put it behind a reverse proxy (e.g. Caddy or Nginx) with a real TLS cert
- **Backups**: since the SQLite file + all storage location drives together are the only copy of agency/policy data, schedule a regular copy of the app folder plus every storage location drive to a separate backup destination — this is also just a file copy, no DB export tooling needed. **The backup destination must also be encrypted** (an encrypted external drive, or an encrypted archive if backing up to less-trusted media) — an unencrypted backup would undo the full-disk encryption above
- **Firewall**: only the host's app port needs to be reachable from the LAN — no need to open anything on the router/internet-facing firewall
- **Future path**: if the agency ever needs multiple host servers, remote access, or heavier concurrent load, the app can be moved to Postgres + Docker Compose on a real server later — the multi-tenant design (Section 2) doesn't need to change, only the database connection and packaging

## 9. Error Handling & Self-Healing
With a self-hosted, single-machine app, several distinct things can go wrong — each should surface a **specific, actionable message**, not a generic "something went wrong."

### Specific Failure Points & User-Facing Messages

| What breaks | Detected how | Message shown | Who sees it |
|---|---|---|---|
| Active storage location's disk is full | Write fails with disk-full error, or proactive free-space check drops below a threshold (e.g. <500MB) | "Can't save this file — the storage drive is full. An admin needs to add a new storage location." | Uploader gets the short version; Super Admin gets an actionable alert with the drive name |
| A storage location (e.g. network drive/NAS) is disconnected or unreachable | Read/write to that path times out or errors | "Documents on [location label] are temporarily unavailable — the drive may be disconnected. New uploads will use another location if available." | Whoever tries to open/upload to that location; logged for Super Admin |
| SQLite database is locked/busy under concurrent writes | Write times out despite retry (see self-healing below) | "The system is busy — please try again in a moment." (should be rare with WAL mode + retry, see below) | Whoever triggered the write |
| Client can't reach the host at all | Repeated fetch/poll failures (e.g. 3 consecutive timeouts) | "Can't reach the server — check that this computer is connected to the network and that the host PC is powered on and running the app." (Section 8 client-side can't reliably distinguish "your network" vs "host is down" vs "app crashed" from a plain HTTP timeout — the message covers all three honestly rather than guessing) | The user on that PC; doesn't affect other PCs if it's local to their machine |
| App process itself crashes or hangs on the host | Host-side health check (below) | Not shown to users directly — self-healing (below) attempts recovery; if it fails repeatedly, Super Admin sees a persistent alert next time they can reach the app | Super Admin, via System Health page |
| Upload fails mid-transfer (network hiccup, browser closed) | Upload request errors or times out | "Upload didn't complete — please try again." No partial file is kept (write to a temp name, only finalize on full success) | Uploader |
| Record lock conflict | Someone tries to edit an already-checked-out record | "This record is being edited by [name] — you can view it, but editing is disabled until they finish or the lock expires." (expected behavior, not an error — see Section 5's Record Locking) | Whoever tries to edit |
| Session/login expired | Auth token invalid/expired on a request | "Your session has expired — please log in again." Redirect to login, preserving where they were headed | Whoever's session expired |
| Email intake can't reach the mailbox (bad credentials, mail server down/unreachable) | IMAP connection/login fails during a scheduled poll | Not shown to end users; a persistent alert appears on the agency's settings/System Health view: "Can't check [inbox] for new inquiries — connection failed since [time]." Retried on the next scheduled poll with backoff; emails aren't lost, they just wait in the inbox until it's reachable again | Agency Head (it's their mailbox) and Super Admin |

### Self-Healing

- **Auto-restart on unresponsiveness**: the app process runs under a lightweight process supervisor (e.g. `pm2` for Node, or a simple watchdog script) that polls a local `/health` endpoint. If health checks fail continuously for a configurable window (e.g. 60–90 seconds), the supervisor restarts the app process automatically — no one needs to manually reboot the host
- **Restart-loop protection**: if the app crashes and gets auto-restarted more than a small number of times in a short window (e.g. 3 restarts in 10 minutes), the supervisor stops auto-restarting and instead leaves a persistent, hard-to-miss alert on the System Health page once someone can reach the app again — repeated crashing usually means a real problem (e.g. corrupted database, full disk) that a restart won't fix, and silently restart-looping forever would hide that
- **Database resilience**: SQLite configured in **WAL (Write-Ahead Logging) mode** with a busy-timeout and automatic retry-with-backoff on lock contention — this handles the normal case of multiple users writing near-simultaneously without surfacing errors to them at all; a user-facing "system is busy" message only appears if that retry itself is exhausted, which should be rare for an office-sized team
- **Proactive disk space monitoring**: each storage location's free space is checked periodically (e.g. every few minutes) rather than only discovered on write failure — the Super Admin gets a warning well before a drive actually fills (e.g. at 90% used), giving time to add a new location before anyone hits a hard failure
- **Failed uploads clean up after themselves**: files are written to a temporary name first and only renamed/finalized on confirmed success, so a failed or interrupted upload never leaves a corrupt or partial file behind
- **System Health page** (Super Admin): shows current status of each storage location (reachable, free space), app uptime, last few restart events (if any) with timestamps, and any active alerts — backed by `RestartEvent` and `SystemAlert` (Section 6), so self-healing stays visible and auditable rather than being invisible "magic"
- **Restarts don't cause permanent lock-outs**: `RecordLock` rows live in the database, not in memory, so an auto-restart (above) doesn't lose track of them — a lock that was active before a crash is still there after, and still expires via its normal idle timeout (Section 5) rather than needing a manual clear

### System Configuration additions (from this section)
- Per-`StorageLocation` low-space threshold and check interval are configurable (sensible defaults, adjustable by Super Admin)
- Auto-restart window and restart-loop threshold are configurable (sensible defaults, adjustable by Super Admin) — advanced setting, not needed day-to-day

## 10. Suggested Build Order (phases)

1. **Scaffold**: project setup, Prisma schema with `Agency` + `agency_id` on every table, seed script (2-3 fake agencies, a few agents/leads)
2. **Reliability foundations**: SQLite in WAL mode with busy-timeout/retry, a `/health` endpoint, and the process supervisor/auto-restart wrapper around it (Section 9) — built early so every later phase runs on top of it rather than bolting it on afterward
3. **First-run setup wizard**: on first launch — before any login system exists to gate it — the wizard has the person setting up the machine (a) create the Super Admin account (email + password, Section 5) and (b) set the first document storage location (default: an internal drive), validating it resolves to a disk/volume different from the app's own. Also build the "add another storage location" flow for when the first one fills up
4. **Auth & tenant scoping**: login (including the Super Admin account created in phase 3), session includes `agency_id` + role, middleware scoping every query
5. **Super Admin**: create agency + first Agency Head account
6. **Agency setup**: Agency Head configures insurance lines/products; account creation with temporary passwords, password reset, deactivation, and Manager assignment (`User.manager_id`) for Managers/Agents (Section 5)
7. **Leads CRUD**: agent creates/edits own leads, pipeline status
8. **Record locking**: check-out on edit, read-only + "being edited by" notice for others, auto-release timeout, manager override
9. **Policies — general**: convert won lead → policy (created as `draft`), document upload (Proof of Payment), the explicit Activate action (`draft` → `active`, gated on minimum required info + documents), the daily renewal/lapsing background job covering both `active` and `grace_period` policies and its three rules, and the explicit Renewal/Payment action (Section 5)
10. **Policies — Life insurance detail forms**: Insured, Owner (with "same as insured" shortcut), Primary/Contingent Beneficiaries
11. **Policies — other lines**: fill in Auto/Property/Health/Travel requirement checklists (Section 11), including the Travel-specific `completed` status and `TravelDetail` table
12. **Manager/Head views**: cross-agent visibility scoped to a Manager's own team vs. the whole agency for Agency Head (Section 3), leaderboard, filters — including the unassigned/needs-review lead queue (Section 5)
13. **Dashboards**: charts (conversion rate, revenue, funnel), filterable by line
14. **Website inquiry intake**: per-agency mailbox config, scheduled IMAP polling, structured-email parsing into Leads, unassigned pool, needs-review fallback (Section 5) — can happen in parallel with the client-facing site's own build
15. **System Health & error messaging**: proactive disk-space monitoring, restart-loop protection, the specific user-facing error messages, and the System Health page itself (Section 9) — the underlying foundations from phase 2 get their visible surface here
16. **Polish**: reminders, CSV export, search across leads/policies (Section 5). Activity log **writes** should be added incrementally as each mutating feature is built (phases 4–15), not bolted on here — this phase is just where the Agency Head/Super Admin **viewing** UI for the log gets built
17. **Package for portable deployment**: bundle into a self-contained folder with start script, verify a copy-paste move to another PC works cleanly, backup script, and confirm full-disk encryption is enabled on the host and every storage-location drive before go-live (see Section 8)

## 11. Minimum Required Information by Line

### Auto Insurance
- Proof of Payment
- Complete Name of Owner
- Car Maker
- Car Model
- Year Car Was Released
- *(Proposed — industry-typical fields, confirm or adjust against this agency's actual policy/product forms before building)*: Plate Number / Conduction Sticker Number, Chassis Number (VIN), Engine Number, OR/CR (Official Receipt / Certificate of Registration) Number, Color, Coverage Type (Comprehensive / CTPL / Acts of Nature / Own Damage / Theft), Valid Driver's License No., Sum Insured

### Life Insurance
- Proof of Payment
- **Insured** (the person being insured): First/Middle/Last Name, Height, Weight (lbs), Present Address, Permanent Address, Religion, Civil Status, Age (computed from Birthdate), Birthdate, Birthplace, Gender at Birth, Weight at Birth, Smoker (yes/no), Father's age (or age at death if deceased), Mother's age (or age at death if deceased), Ages of up to 3 Brothers, Ages of up to 3 Sisters
- **Owner** (policy owner — same person as Insured unless e.g. a parent buying for a child): same personal fields as Insured, plus Mobile No., Telephone No., Employer/Business Name, Employer/Business Address, Nature of Business, Occupation, Total Years in Employment/Business, TIN No., SSS No., Valid ID (ID No. + Expiration Date)
- **Primary Beneficiaries** (up to 3): First/Middle/Last Name, Permanent Address, Birthdate, Age (computed), Mobile No., Relationship to Insured
- **Contingent Beneficiaries** (up to 2): same fields as Primary Beneficiaries

*(Property/Fire, Health/HMO, Travel: proposed drafts below, pending your confirmation.)*

### Property / Fire Insurance
- *(Proposed — industry-typical fields, confirm or adjust before building)*: Property Address/Location, Type of Construction (concrete / wood / mixed), Occupancy or Use (residential / commercial / industrial), Sum Insured / Property Value, Proof of Ownership (Title or Tax Declaration), Perils Covered (fire, lightning, earthquake, flood/typhoon, etc.), Proof of Payment

### Health / HMO
- *(Proposed — industry-typical fields, confirm or adjust before building)*: Insured's Name, Birthdate, Existing Medical Conditions/History, Plan/Coverage Tier, Dependents (Name, Relationship, Birthdate — if a family/group plan), Room & Board Limit, Pre-existing Condition Disclosure, Proof of Payment

### Travel Insurance (per-trip, fixed duration — confirmed)
- *(Proposed — industry-typical fields, confirm or adjust before building)*: Traveler Name, Passport Number, Destination(s), Trip Start/End Dates (`Policy.start_date`/`renewal_date`), Purpose of Travel, Coverage Type (medical, baggage, trip cancellation/delay), Sum Insured, Proof of Payment

## 12. Open Questions to Settle Before/During Build

### Needs your confirmation (drafted with reasonable defaults so nothing is left blank)
- The proposed Auto, Property/Fire, Health/HMO, and Travel minimum-required-info field lists (Section 11) are industry-typical drafts, not verified against this agency's actual policy documents or forms
- The exact data retention / right-to-deletion period under the Philippine Data Privacy Act — the app's default behavior (nothing auto-deleted, Section 5's Audit/Activity Log) works regardless of the answer, but the actual retention period is a legal question worth confirming with counsel or official DPA guidance

### External action items (not resolvable by editing this document)
- Confirming the internal secondary drive for launch is sourced and ready before go-live (default/recommended option per Section 8) — network drive remains available as a fallback or later addition
- Client-facing inquiry site itself isn't designed yet — separate project/plan, but it needs to (a) send inquiries as structured emails matching whatever field format the CRM's parser expects, and (b) know which agency's inbox to send to, if the site ever serves more than one agency
- Starting with Gmail for intake means an App Password needs to be generated per agency (requires 2-Step Verification enabled on that Google account) — worth having that set up before the Website Inquiry Intake build phase (Section 10), since it's the credential the app will need
- **App name "Saripda Suite" not yet formally cleared** — a web search turned up no conflicting products or companies, but an actual IPOPHL trademark search ([wipopublish.ipophil.gov.ph](https://wipopublish.ipophil.gov.ph/wopublish-search/public/trademarks)) and DTI Business Name check ([bnrs.dti.gov.ph](https://bnrs.dti.gov.ph)) still need to be done before registering the name anywhere — pending, to be done later

---
*Hand this file to Claude Code as your starting spec — it can scaffold the project structure, Prisma schema (Section 6), and initial pages directly from Sections 6–11.*
