# Commons Roadmap — Ready Before ASCENDRA-PAY-003 Architecture

| Version | Date | Status |
|---|---|---|
| 0.1 | 2026-10-30 | **Plan only. Nothing in this roadmap has been built.** Written from the commons readiness audit agreed with the PO. |
| 0.2 | 2026-10-30 | Execution hold recorded (§0); branching and release grouping agreed (OD4, OD7); OD1 decided. |

## 0. First item: execution hold

**No code change in ascendra-commons, ascendra-commons-sandbox or ascendra-commons-ui starts until the PO gives an explicit go-ahead** (PO, 2026-10-30). Until then this roadmap is planning only. When the go-ahead comes, work starts with WS0, beginning with a short WS0 plan for PO review.

Agreed working rules for when execution starts:

- **One branch per workstream in each repo** it touches (e.g. `ws0-fail-closed-platform-reach`). The PO decides when to commit and merge (OD7).
- **One coordinated breaking release per workstream**, with one `UPGRADING.md` (OD4).
- Order inside each workstream: commons → re-vendor into the sandbox → sandbox tests → commons-ui.


## 1. Why this roadmap exists

`ascendra-commons` exists to take common, system and cross-cutting concerns **out of feature code**. Feature code implements the core feature logic. Everything else sits outside, behind seams that feature code consumes. This applies to Ascendra Pay and to every later initiative.

PAY-003 research (Partner, Payment Rail, Payment Link, Merchant Tier and KYB) showed that today's 15 modules are not yet enough for PAY-003. If the gaps are left until PAY-003 delivery, they become either ad-hoc feature code or PAY-003 scope. **So commons is made fully ready before PAY-003's `/gen-architecture`.**

### 1.1 What "ready" means

| Bucket | Meaning | Done when |
|---|---|---|
| **Build** | The shape is known and needs no external fact | Merged in commons, vendored into the sandbox, acceptance tests pass there, commons-ui console exists (where the module has an admin or observability surface), README has "Consuming this module" |
| **Seam + simulated** | The shape needs a real counterparty (a payment Provider's API) to be final | Port merged, a **simulated adapter** in the sandbox, tests pass against it, README states "provisional until ⟨named external fact⟩". Feature code can integrate now; only the concrete adapter arrives later. |
| **Product** | Domain logic; belongs in PAY-003, not commons | Listed here only so nobody builds it in commons |
| **Later** | Needs a customer or partner fact that doesn't exist yet | Listed with its trigger. The Build items must not block it. |

### 1.2 Scope rule

Build only what PAY-003's beachhead (R1–R3) and its seven known operating models (M1–M7) need. **Not everything imaginable.** Every module stays lite and open for extension: Model 1 now, with the Model 2 seam named and not built (`MODULE-STANDARD.md` §6).

### 1.3 Two tracks, one gate

```
Track 1 — PAY-003 Problem Domain:  priming → intake → domain discovery → BRD → epics → screen design ─┐
                                                                                                    ├─► Commons Ready gate ─► /gen-architecture
Track 2 — commons (this roadmap):   WS0 → WS1 → WS2 → WS3 → WS4 → WS5 → WS6 → WS7 ─────────────────────┘
```

- Track 1 doesn't depend on commons, so this work runs in parallel and doesn't add to the PAY-003 timeline unless Track 2 becomes the critical path (§9).
- **Names follow the PAY-003 glossary.** Where domain discovery hasn't settled a term yet (Site, Advance/Credit), commons uses a provisional name and renames before release.

## 2. Sources

| Source | Path (relative to `ascendra-public/`) |
|---|---|
| Beachhead capabilities R1–R3 | `ascendra-framework/projects/ASCENDRA-PAY-003/research/06-beachhead-readiness.md` §1.2, §2.2, §3 |
| Tenancy foundation (Partner, Issuer, Site, Group; M1–M7; security finding F1) | `…/research/09-tenancy-foundation-plan.md` |
| Payment Rail and Payment Link | `…/research/10-payment-rail-and-link-plan.md` |
| Merchant Tier and KYB; ledger; open banking; licensing; pending-updates register | `…/research/11-review-clarifications-2026-10-29.md` |
| Decisions D1–D27 | `…/research/00-decisions-log.md` |
| Workflow pattern (the only PAY-002 standard not yet promoted to commons) | `../ascendra-pay-002/projects/ASCENDRA-PAY-002/standards/workflow-engine-pattern.md` |
| Module rules | `MODULE-STANDARD.md`, `README.md` (this repo) |

Baselines at audit time (2026-10-30): commons `165108c`, sandbox `2a6055c`, commons-ui `8d7d3d9`. Re-verify with `git log -1` before starting a workstream.

## 3. Capability audit

Every PAY-003 beachhead capability, the cross-cutting concerns inside it, and where each concern lives.

### 3.1 R1 — Cash-Collection Ready (note 06 §1.2)

| # | Capability | Cross-cutting concerns | Where | Bucket |
|---|---|---|---|---|
| R1-A | Tenancy & access | Platform → Partner → Issuer, Site, roles, audit of every money action | `multi-tenancy`, `authorization`, `audit-logging` (WS0, WS1) | Build |
| R1-B | Payer register + bulk Excel/CSV import with a validation report | File parsing, column mapping, row validation, report, idempotent commit | **`data-import` (new)** | Build |
| R1-C | Fee setup (heads, plans, concessions) | — | — | Product |
| R1-D | Opening balances, signed off by the Accountant | Bulk import; maker-checker sign-off | **`data-import`**, **`workflow` (new)** | Build |
| R1-E | Billing run: draft → review → bulk issue; re-run safe | Scheduled runs; approval step; idempotency per period | `background-jobs`, **`workflow`**, `idempotency-key` | Build |
| R1-F | Voucher PDF with reference + barcode/QR; bulk PDF per class | PDF rendering, barcode/QR, branding, bulk jobs, storage | **`document-rendering` (new)**, `file-storage`, `background-jobs` | Build |
| R1-G | Email: voucher, reminder, dues notice, receipt; bounce tracking | Delivery, templates, schedule, suppressions | `notification` | Build (exists) |
| R1-H | Cashier counter; receipts sequential per Issuer with no gaps; Void approved by the Accountant | Gapless numbering; maker-checker approval; receipt PDF | **`reference-number` (new)**, **`workflow`**, **`document-rendering`** | Build |
| R1-I | Cash session, variance, handover, Cash Deposit | — | — | Product |
| R1-J | Adjustments (cancel, credit note, manual refund) | Audit; immutable money records | `audit-logging` | Product + existing |
| R1-K | Reports + Excel/CSV export | Streamed, capped CSV export | api-contract Rule 9 (a convention, not a module) | Product |
| — | Collection Reference: ~10 digits, check digit, never reused (§2.3) | Allocation, check digit, validation | **`reference-number`** | Build |

### 3.2 R2 — Bank-Transfer Reconciliation Ready (note 06 §2.2)

| # | Capability | Cross-cutting concerns | Where | Bucket |
|---|---|---|---|---|
| R2-A | Link presentation (pay page, bank details, reference) | Secure token, payer scope, rate limiting, viewed signal, short code | `payment-link-security` (extended), `multi-tenancy`, `rate-limiting` | Build |
| R2-B | Payment Claim (amount, date, transaction id, screenshot) | File upload; claim expiry job | `file-storage`, `background-jobs` | Product + existing |
| R2-C | Statement import, saved per-bank mapping, idempotent lines | Parsing and mapping; record each credit once | **`data-import`**, **`payment-rail` (new)** inbound ledger | Build |
| R2-D | Matching engine (rules 1–4) | Rule pipeline runner; suggestion vs auto | **`reconciliation` (new)**: generic runner. The rules are Product. | Build + Product |
| R2-E | Exceptions queue (unmatched, ambiguous, mismatch, duplicate, stale) | Queue, assignment, resolution, audit, console | **`reconciliation`** | Build |
| R2-F | Settlement → revoke siblings → receipt | Domain events; retries; notification | `domain-events`, `background-jobs`, `notification` | Product + existing |
| R2-G | Bank reconciliation report | — | — | Product |
| R2-H | Period close / lock | — | — | Product (revisit if a second product needs period locks) |

### 3.3 R3 — First Rail (note 06 §3, note 10)

| Capability | Concerns | Where | Bucket |
|---|---|---|---|
| Dynamic QR / RTP Presentations | Outbound connector port, capabilities, Rail Account resolution | **`payment-rail`** (`RailConnector`, `RailAccountResolver`) | **Seam + simulated** |
| Real-time credit notifications / webhooks | Signature verification, record once, out-of-order handling, tenant resolution | **`payment-rail`** inbound ledger | Build |
| RTP-Later Payer opt-in | Revocable, audited consent | **`consent` (new)** | Build |
| KYB per Rail Account (note 11 §1.5) | Multi-step approval per relationship; document checklist | **`workflow`** (one instance per Issuer × Rail Account), `file-storage` | Build |
| Concrete connectors (Bank X, 1GO, PayFast) | — | — | Product (later) |

### 3.4 Operating models M1–M7 (note 09 §4)

| Need | Where | Bucket |
|---|---|---|
| Partner scope and RLS branch, partner roles, partner config level, tenant directory, context switcher | `multi-tenancy`, `authorization`, `notification`, commons-ui (WS2) | Build |
| Runtime theming per Partner / Issuer | ascendra-ui / commons-ui shell (WS2) | Build (first to drop if Track 2 runs long) |
| Issuer Group consent and visibility | `consent` + a group scope | Later (first franchise customer) |
| Partner API keys, custom domains, SSO, partner billing, per-partner quotas | — | Later (signed partner) |

## 4. Master backlog by workstream

Sizes are relative (**S** / **M** / **L**), not estimates. Item ids refer to the detailed designs: **T** = note 09, **RL** = note 10. "Repos" shows which of commons (C), sandbox (S) and commons-ui (U) each item touches.

### WS0 — Security (first; independent of everything)

| Item | What | Repos | Size | Ref |
|---|---|---|---|---|
| WS0.1 | Fail-closed platform reach in `multi-tenancy`, `audit-logging.api`, `notification.api`, `file-storage` | C | M | T0.1, T0.3–T0.5 |
| WS0.2 | `multi-tenancy` id type (`text`) | C | S | T0.2 |
| WS0.3 | Record and enforce the rule in `MODULE-STANDARD.md` and `scripts/check.js` | C | S | T0.6 |
| WS0.4 | Sandbox: explicit platform actions; vendor `multi-tenancy` + `file-storage`; RLS proven; regression tests | S | M | T0.7, T0.8, T0.11 |
| WS0.5 | commons-ui: platform detected from `allowedActions` | U | S | T0.9 |
| WS0.6 | Consumer survey before the `!` commits | — | S | T0.10 |

### WS1 — Tenancy foundation

| Item | What | Repos | Size | Ref |
|---|---|---|---|---|
| WS1.1 | Tenant registry (Partner #1 seeded) | C, S | S | T1.1 |
| WS1.2 | Actor gains `partnerId`, `siteIds`; session context and memberships | C, S, U | M | T1.2, T1.6, T1.11 |
| WS1.3 | Partner- and Site-scoped role assignments; resolver; Site helpers; `SiteDirectory` port | C, S, U | L | T1.3–T1.5, T1.9 |
| WS1.4 | Audit events carry `partner_id`, `site_id` | C, S | S | T1.7 |
| WS1.5 | Configuration-chain design **and a shared resolver helper** (used by WS2.3, WS5.2, WS6.2) | C | M | T1.8 |

### WS2 — Partner support

| Item | What | Repos | Size | Ref |
|---|---|---|---|---|
| WS2.1 | Partner scope + opt-in RLS branch | C, S | M | T2.1 |
| WS2.2 | Partner roles; partner access-management branch | C, S, U | M | T2.2 |
| WS2.3 | Notification partner level (routes, templates, credentials chain) | C, S, U | M | T2.3 |
| WS2.4 | Audit partner read scope | C, U | S | T2.4 |
| WS2.5 | `TenantDirectory` port; three viewer kinds; Partner column/filter; context switcher | U | M | T2.5 |
| WS2.6 | Runtime theming (Partner → Issuer) | U (+ ascendra-ui) | M | T2.6 |
| WS2.7 | Sandbox partner personas + tests | S | S | T2.7 |

### WS3 — Payment Link

| Item | What | Repos | Size | Ref |
|---|---|---|---|---|
| WS3.1 | Documentation fixes (receipt mode, resource = Payment Request); payer-scope wiring guidance | C | S | RL-A2 |
| WS3.2 | Vendor in the sandbox with a demo pay page under payer scope + rate limiting | S | M | RL-A4 |
| WS3.3 | `payment-link-security.ui` | U | S | RL-A5 |
| WS3.4 | Viewed signal (`resourceId` on resolution; `onResolved` hook) | C, S | S | RL-B1 |
| WS3.5 | Short code with challenge and lockout | C, S, U | M | RL-B2 |
| WS3.6 | Optional retention expiry | C | S | RL-B3 |

### WS4 — Payment Rail, inbound

| Item | What | Repos | Size | Ref |
|---|---|---|---|---|
| WS4.1 | `payment-rail` README / design (before code) | C | S | RL-A3 |
| WS4.2 | `payment-rail.core` types + `InboundCreditLog` + observability; `.core.postgres-drizzle`; `.api` | C | L | RL-B4 |
| WS4.3 | Sandbox: manual + CSV statement credit sources (via `data-import`) | S | M | RL-B5 |
| WS4.4 | `payment-rail.ui` (credit log, outcomes) | U | M | RL-B6 |

### WS5 — New modules

| Item | What | Repos | Size | Brief |
|---|---|---|---|---|
| WS5.1 | `data-import` | C, S, U | L | §5.1 |
| WS5.2 | `document-rendering` | C, S, U | L | §5.2 |
| WS5.3 | `reference-number` | C, S | S | §5.3 |
| WS5.4 | `reconciliation` (generic runner + exception queue) | C, S, U | L | §5.4 |
| WS5.5 | `workflow` (lite; promoted from PAY-002) | C, S, U | M | §5.5 |
| WS5.6 | `consent` | C, S, U | S | §5.6 |

### WS6 — Payment Rail, outbound seams (simulated)

| Item | What | Repos | Size | Ref |
|---|---|---|---|---|
| WS6.1 | `RailConnector` port + capabilities, **provisional until the first real Provider's API** | C | M | RL-C1 |
| WS6.2 | `RailAccountResolver` (configuration chain; inbound account → tenant) | C | M | RL-C2 |
| WS6.3 | Presentation event log; webhook claims keyed by Rail Account | C | M | RL-C3 |
| WS6.4 | Simulated Provider in the sandbox (QR, RTP, signed webhooks, duplicates, out-of-order) | S | L | RL-C6 |
| WS6.5 | `payment-rail.ui`: connector health, presentation events | U | M | RL-C7 |

### WS7 — Deprecation and index

| Item | What | Repos | Size | Ref |
|---|---|---|---|---|
| WS7.1 | Freeze and deprecate `payment-gateway-adapter`, with `UPGRADING.md` | C | S | RL-C4 |
| WS7.2 | **Seam index** (`SEAMS.md`): every module, port, what the feature supplies, what the module does. `/gen-architecture` reads this instead of re-deriving it. | C | M | §7 |

### 4.1 Order and dependencies

```
WS0 ──► WS1 ──► WS2
          │
          ├──► WS3 (needs WS0's payer-scope fix)
          │
          ├──► WS5.3 reference-number ─┐
          ├──► WS5.1 data-import ──────┼──► WS4 (statement source uses data-import) ──► WS5.4 reconciliation
          ├──► WS5.2 document-rendering│                                                 (consumes payment-rail credits)
          ├──► WS5.5 workflow          │
          └──► WS5.6 consent           │
                                       └──► WS6 (needs WS1.5 config chain, WS4) ──► WS7
```

WS5 modules are independent of each other (except as drawn) and can be built in any order once WS1 is done. Suggested order by first use in R1: `reference-number` → `data-import` → `document-rendering` → `workflow` → `reconciliation` → `consent`.

## 5. New module briefs

Each brief is the starting point for the module's README. Each module must pass all eleven dimensions of `MODULE-STANDARD.md` (or opt out with a reason).

### 5.1 `data-import`

- **Purpose:** bulk upload of tabular data (CSV/XLSX) into a feature's records, with a validation report before anything is committed.
- **Feature supplies:** a target definition (fields, types, required, per-row rules, cross-row rules such as uniqueness), and a commit function.
- **Module does:**
  - file parsing (CSV, XLSX);
  - column mapping, with **saved templates** (e.g. a per-bank statement format);
  - per-row validation, and a report of valid, invalid and warning rows;
  - a dry run;
  - an **idempotent commit**: a file or row fingerprint, so a re-upload never double-counts;
  - large files as background jobs, with progress;
  - an audit record per import.
- **Packages:** `.core` (ports, types), `.core.postgres-drizzle` (import runs, row results, mapping templates), `.api` (upload, preview, commit, history); commons-ui `data-import.ui` (wizard: upload → map → review → commit; history).
- **Uses:** `file-storage` (the uploaded file), `background-jobs`, `idempotency-key`, `audit-logging`.
- **Out of scope (Model 2 later):** PDF statement parsing, scheduled pulls from an SFTP or API source, transformation scripting.
- **PAY-003 uses:** Payer register (R1-B), opening balances (R1-D), statement import (R2-C).

### 5.2 `document-rendering`

- **Purpose:** produce branded documents (PDF) from a template and data, single or in bulk.
- **Feature supplies:** a template (layout and fields), the data, and the document type.
- **Module does:**
  - rendering (HTML template → PDF);
  - barcode and QR generation;
  - branding resolved through the configuration chain (Partner → Issuer logo and colours, WS1.5);
  - bulk jobs (one merged PDF or a zip);
  - stores the result through `file-storage` and returns a link;
  - marks reprints ("Duplicate").
- **Model 1 / Model 2:** the renderer is an adapter. The engine choice (e.g. headless Chromium vs a PDF library) is decided in module design; it's a Model 1/2 seam, not a commitment now.
- **Packages:** `.core` (ports: `DocumentRenderer`, `TemplateRegistry`), a renderer adapter package, `.api` (render, bulk status); commons-ui: render-job log.
- **Out of scope:** a visual template designer, Word/Excel output, e-signature.
- **PAY-003 uses:** Voucher (R1-F), receipts (R1-H), bulk print per class, later statements of account.

### 5.3 `reference-number`

- **Purpose:** allocate human-facing numbers safely under concurrency.
- **Feature supplies:** a sequence definition: scope (per tenant, per year, platform-wide), format (length, prefix, padding), check-digit scheme (Luhn or mod-97), and gapless or not.
- **Module does:**
  - concurrency-safe allocation;
  - **gapless** sequences where required (allocated inside the caller's transaction);
  - check-digit generation, plus validation of a typed or scanned number (catches a teller's typo).
- **Shape:** flat, single folder (like `optimistic-locking`); one table for sequence state.
- **PAY-003 uses:** Collection Reference (note 06 §2.3), receipt numbers (R1-H, gapless), later invoice numbers (FBR, note 03).
- **Decided (OD1):** the Collection Reference is unique across the whole platform (PAY-003 D28).

### 5.4 `reconciliation`

- **Purpose:** match external records to internal expectations, and manage what can't be matched.
- **Feature supplies:** match rules, in order (e.g. "Collection Reference in narration → auto", "amount equals one open request → suggest only"), a candidate lookup, and the action to take on a confirmed match.
- **Module does:**
  - runs the rule pipeline on each incoming item;
  - records the outcome (auto-matched, suggested, exception) with the rule that fired;
  - an **exception and suggestion queue** with types (unmatched, ambiguous, amount mismatch, duplicate, stale), assignment, resolution actions (match, split, mark not relevant, flag a refund), and an audit trail;
  - a console.
- **Relation to `payment-rail`:** `payment-rail` guarantees each credit is recorded once. `reconciliation` decides what it belongs to. The input is generic: anything with an id, amount, date and text, so it works for statement lines, rail credits and, later, payouts or partner reports.
- **Packages:** `.core`, `.core.postgres-drizzle` (match results, exceptions), `.api`; commons-ui `reconciliation.ui` (queue, exception detail, resolution).
- **Out of scope:** the rules themselves (Product); machine-learned matching.
- **PAY-003 uses:** R2-D (runner), R2-E (queue), R3 rail credits.

### 5.5 `workflow` (lite)

- **Origin:** PAY-002 `standards/workflow-engine-pattern.md`, the only PAY-002 standard not yet promoted to commons. Promote it **as designed there, kept lite**.
- **Purpose:** data-driven multi-step approvals, so features never hard-code step order or transition rules.
- **Shapes (from PAY-002):** `WorkflowDefinition` (key, ordered steps), `WorkflowStepDef` (`requiresDecision`), `WorkflowInstance` (definition, `entityType`, `entityId`, current step, status), `StepInstance` (status: pending / in_review / approved / rejected / needs_info; assignee, decider, notes).
- **Model 1 — build:** a **linear engine**. Steps run strictly in order; each must be approved before the next; a rejection ends the instance; definitions come from configuration (seed or table), never `if` statements. Plus **maker-checker**: the actor who requested can't approve (R1-H Void, R1-D opening balances, R1-E billing run).
- **One instance per relationship:** an Issuer's KYB at each Rail Account is its own instance (note 11 §1.5). This is the PAY-002 Model 2 *scenario*, served by Model 1's data model.
- **Model 2 — named, not built:** branching, dependencies between definitions ("Bank X KYB can't start until base onboarding is approved"), SLA timers. The data model must not block them; only engine logic and new definition rows are added later.
- **Emits:** `domain-events` on step decisions and completion; `audit-logging` for every decision; `notification` for assignees.
- **Packages:** `.core`, `.core.postgres-drizzle`, `.api`; commons-ui `workflow.ui` (my approvals inbox; instance timeline; definitions viewer).
- **Out of scope:** BPMN, a visual designer, parallel steps, scripting.
- **PAY-003 uses:** Issuer onboarding, KYB per Rail Account, Void approval, opening-balance sign-off, billing-run approval.

### 5.6 `consent`

- **Purpose:** record, check and revoke a subject's consent to something, with history.
- **Feature supplies:** consent types (key, description, version) and the subject and object ids.
- **Module does:** grant, revoke, "is consent active now?", expiry, version (re-consent when the text changes), history, audit.
- **Shape:** flat or `.core` + `.core.postgres-drizzle`; a small read UI (consents per subject).
- **PAY-003 uses:** RTP-Later Payer opt-in (note 08 §13.3); later Issuer Group visibility (note 09) and data-processing consent.

## 6. Product, not commons (PAY-003 builds these)

- Fee setup, fee plans, concessions (R1-C)
- Cash session, variance, Cash Deposit (R1-I)
- Payment Request and Presentation lifecycle; settlement; sibling revocation logic (R2-F)
- Match rules (R2-D) and the bank reconciliation report (R2-G)
- Period close (R2-H)
- Concrete rail connectors (Bank X, 1GO, PayFast, Safepay, 1Bill endpoint)
- Site settlement resolution (RL-C8)
- Reports and exports (R1-K, following api-contract Rule 9)
- The PAY-003 tenancy and payments standards (T1.12, RL-A6)

## 7. The Commons Ready gate (before `/gen-architecture`)

- [ ] Every **Build** item (WS0–WS5, WS6.2–WS6.5, WS7) is merged in commons, re-vendored into the sandbox, its acceptance tests pass there, its commons-ui console exists where applicable, and its README has "Consuming this module".
- [ ] Every **Seam + simulated** item (WS6.1) has its port, the simulated Provider, passing tests, and a written "provisional until the first real Provider's API".
- [ ] Breaking changes are released per workstream with an `UPGRADING.md`.
- [ ] `node ascendra-commons.js status` is clean in the sandbox.
- [ ] Every module passes `MODULE-STANDARD.md` (or opts out with a reason).
- [ ] **`SEAMS.md` (WS7.2)** lists every seam PAY-003 can rely on: module, port, what the feature supplies, what the module does, sandbox example.
- [ ] Commons names match the PAY-003 glossary from domain discovery (Site, Advance/Credit, Beneficiary).

## 8. Open decisions

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| OD1 | **Collection Reference uniqueness** | **Decided 2026-10-30: platform-wide** (PAY-003 D28) | — |
| OD2 | Renderer engine for `document-rendering` | Decide in module design; keep it behind an adapter | WS5.2 |
| OD3 | Whether `consent` is its own module or folds into another | Own small module (§5.6): its uses span payments, groups and privacy | WS5.6 |
| OD4 | Release grouping of `!` changes | **Decided 2026-10-30:** one coordinated release per workstream, with one `UPGRADING.md` | — |
| OD7 | Branching | **Decided 2026-10-30:** one branch per workstream per repo; the PO commits and merges | — |
| OD5 | Which other projects vendor commons today | Survey first (WS0.6) | WS0 |
| OD6 | Final names: Site, Advance/Credit, "Rail" | From PAY-003 domain discovery; provisional until then | Gate |

## 9. Risks

| Risk | Mitigation |
|---|---|
| Track 2 becomes the critical path and delays PAY-003 architecture | Track progress against Track 1's stage. If Track 2 is behind at BRD approval, drop in this order: WS2.6 theming → WS5.6 consent → WS2.5 context switcher. Each is additive later. |
| Commons designed ahead of the glossary | Provisional names; rename before release (OD6) |
| New modules grow beyond lite | Each brief's "Out of scope" line is binding; Model 2 is named, never built, without a concrete case |
| A simulated Provider hides real API constraints | WS6.1 stays provisional; finalise against the first real API (note 10 RL-C1) |
| Breaking changes ripple into existing consumers | WS0.6 survey; one release per workstream with `UPGRADING.md` |
