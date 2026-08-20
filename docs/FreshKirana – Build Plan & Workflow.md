# FreshKirana – Build Plan & Workflow

**Version:** 1.0 · **Date:** 2026-08-12
**Team:** Shubham + Claude
**Specification:** `FreshKirana – Scalable Grocery Marketplace Documentation Set.md` (v2.2)
**Program checklist:** `FreshKirana – Pre-Build Readiness Checklist.md`

This document is the **operating agreement for the build**. It defines how we work, what order we build in, and what "done" means for every unit of work. It is the file to open at the start of any session.

---

# Part I — How We Work

## 1. The unit of work is a **Part**

The build is 8 phases containing **41 parts**. A part is a vertical slice sized to be finished and verified in one to three working sessions. We build **one part at a time, in order.** No part begins until the previous one has passed its confirmation.

## 2. The cycle for every part

| Step | Who | What |
|---|---|---|
| **1. Propose** | Claude | Short plan: files to create/change, approach, anything ambiguous. No code yet |
| **2. Approve** | Shubham | Confirm or redirect. This is where design disagreements are cheap |
| **3. Build** | Claude | Write the code and the automated tests |
| **4. Automated check** | Claude | Tests, type-check, lint, boundary checks — all green before handing over |
| **5. Confirmation test** | **Shubham** | Run the manual steps written for that part. This is the real gate |
| **6. Record** | Both | Tick the part in the Progress Tracker (§Part III). Note anything deferred |
| **7. Next** | | Only now does the next part begin |

**Step 5 is the point of this whole document.** Automated tests prove the code does what I think it does. The confirmation test proves it does what *you* need. Both are required.

## 3. When a confirmation test fails

1. You describe what you saw — actual behaviour, not a diagnosis.
2. I find the cause and fix it.
3. **The full confirmation test is re-run from step 1**, not just the failing step.
4. If it fails three times, we stop and reconsider the approach rather than patching further.

## 4. What blocks and what doesn't

Some parts depend on external accounts (WhatsApp BSP, payment gateway) that have weeks of lead time. **These never block the build.**

> **Mock-first rule:** every external integration is built behind an interface with a working mock implementation first. The mock is what the confirmation test exercises. When the real account arrives, we swap the implementation and re-run the same confirmation test against the live service.

Parts with this pattern are marked **⚙ mock-first** below.

## 5. Session resume protocol

I start each session with no memory of the last one. To resume:

> "Read `FreshKirana – Build Plan & Workflow.md`. We're on part **[ID]**. [Status: not started / in progress / awaiting confirmation]."

I'll read this file, the spec sections it points to, and the current code, then pick up from there. **Keep the Progress Tracker current — it's the handoff.**

## 6. Standing rules for the build

| # | Rule | Source |
|---|---|---|
| R1 | Every feature ships with its analytics events | §5.1, G1 |
| R2 | Module boundary CI checks stay green — never disabled to "unblock" | §2.1.1, G2 |
| R3 | The three AI interfaces stay in place with rule implementations behind them | §2.17.2, G3 |
| R4 | Idempotency keys on order, payment, refund, inventory endpoints | §3.3, G4 |
| R5 | Ledger debits equal credits — asserted in tests and a nightly job | §2.4.4, G5 |
| R6 | Nothing merges with a failing test or a skipped confirmation | — |
| R7 | Secrets never in the repo | §3.3 |
| **R8** | **Everything runs on GCP.** API, database, every frontend surface, jobs, images, secrets. Nothing in the delivered product depends on a local machine, and no component ships without a GCP home | Confirmed 2026-08-18 |

## 7. Effort notation

Estimates are in **sessions** (one focused working block), not calendar time — calendar depends entirely on your availability. Treat them as relative sizing, not commitments.

---

# Part II — The Build

## Phase overview

| Phase | Title | Parts | Est. sessions | Milestone |
|---|---|---|---|---|
| **0** | Foundation | 5 | 8–12 | Deployable skeleton |
| **1** | Catalog & Discovery | 5 | 12–16 | Browsable catalog |
| **2** | Ordering | 7 | 16–22 | 🎯 **V0 — real orders work** |
| **3** | Inventory & Payments | 5 | 14–18 | Money moves |
| **4** | Grocery Mechanics | 3 | 10–14 | Grocery-correct |
| **5** | Money Infrastructure | 4 | 12–16 | Books balance |
| **6** | Fulfilment | 3 | 8–12 | Delivery tracked |
| **7** | Vendor & Admin Depth | 3 | 10–14 | Self-service ops |
| **8** | Hardening & Launch Readiness | 7 | 17–22 | 🎯 **MVP complete** |
| | **Total** | **42** | **107–146** | |

> **Production gate:** P8.6 (auth hardening) was split out of P0.3 on 2026-08-12. Until it lands there is **no real authentication** — only a development login. The product cannot go to production without it, regardless of what else is finished.

**Two exit points.** Phase 2 ends at **V0** — a genuinely usable product that can take real orders with COD and WhatsApp-based vendor ops. You could pilot there. Phase 8 ends at the full MVP as specified in §7.0.

---

## PHASE 0 — Foundation

*No user-visible value. Everything else depends on it. Do not rush it.*

### P0.1 — Monorepo, contracts package, CI
**Builds:** Repo per §2.3 layout · npm workspaces · `packages/contracts` · TypeScript strict · ESLint/Prettier · GitHub Actions running build+lint+test
**Confirm:** `npm run build` succeeds from root. Open a trivial PR — CI runs and goes green. Break a type deliberately — CI goes red.
**Est:** 1–2

### P0.2 — Database & module skeleton
**Builds:** PostgreSQL + Drizzle · migration runner · folders for the 22 modules of §2.2 · schema-per-module · **boundary lint (no cross-module imports, no cross-schema reads, no circular deps)**
**Confirm:** Run migrations up, then down, then up — clean each time. Add an import from `order` into `payment`'s internals — **CI must fail.** Remove it — CI passes.
**Est:** 2–3 · *Rule R2 starts here*

### P0.3a — Identity model & plumbing
> **Split from the original P0.3 on 2026-08-12.** The authentication *ceremony* (OTP, SMS, refresh rotation) makes day-to-day development slow, so it moves to **P8.7**. The identity *model and scoping* cannot move: every table in Phases 1–2 keys off it, and §3.2 resource-level scoping has to be in the first query or every later query needs re-auditing.

**Builds:** User / vendor-staff / role tables · the 9 roles of §3.2 · RBAC guards, **deny-by-default** · `@CurrentUser()` decorator · **resource-level scoping** (vendor staff → own store only) · **dev-only `POST /dev/login-as`** issuing a token for any role with no OTP · seeded users per role · `authAs(role)` test helper · long-lived dev tokens

**Confirm:** `POST /dev/login-as {"role":"customer"}` returns a token instantly, no OTP. Protected endpoint without a token → 401. Customer token on an admin endpoint → 403. Vendor A's staff reading Vendor B's data → 403. Set `NODE_ENV=production` and `/dev/login-as` **does not exist** (404).

**Est:** 2–3

### P0.4 — Observability & analytics ingest
**Builds:** Structured logging with correlation IDs · `/health` and `/metrics` · **analytics event ingest endpoint and storage** (§5.3)
**Confirm:** Make one API call — find every log line for it by correlation ID. POST a test event — see it stored with its properties.
**Est:** 1–2 · *Rule R1 depends on this existing first*

### P0.5a — Containerisation
**Builds:** Multi-stage Dockerfile (non-root, tini for signal handling, migrations shipped in the image) · `.dockerignore` · CI job that builds the image, proves it **refuses to start in production** without real auth, then boots it against Postgres and smoke-tests `/health` and `/metrics`

**Confirm:** `docker build -t freshkirana-api:local .` · `docker run --rm -e NODE_ENV=production freshkirana-api:local` **must exit non-zero** naming P8.6 · running it with `NODE_ENV=development` and a `DATABASE_URL` serves `/health`.

**Est:** 1–2 · *Cloud-agnostic — no A2 dependency*

### P0.5b — Cloud provisioning & staging
> **Blocked on decision A2** (cloud provider). Nothing else in the build depends on this, so it can land any time before Phase 1 ends.

**Builds:** Terraform for the chosen provider · managed container platform · managed PostgreSQL with PostGIS + Redis · secrets management · staging environment · auto-deploy from `main` with migrations applied before the new version starts

**Confirm:** Open the staging URL — health check responds. Push a visible change to `main` — it appears on staging with no manual step. Restore staging from a backup.

> **Consequence of the P0.3 split:** until P8.6 lands there is no real authentication, so staging must run with `NODE_ENV=development` and be network-restricted (IP allowlist or private ingress). It must not be publicly reachable.

**Est:** 2–3

---

## PHASE 1 — Catalog & Discovery

### P1.1 — Master catalog
**Builds:** `master_product` per §2.4.1 including HSN, GST rate, veg mark, **Legal Metrology fields** · categories · attributes · admin CRUD API
**Confirm:** Create a product with all fields via API. Retrieve it. Attempt to create one missing net quantity or country of origin → **rejected with a clear error** (§3.7.3).
**Est:** 2–3

### P1.2 — Vendors & offers
**Builds:** Vendor entity, store profile, staff, FSSAI/GST fields · `vendor_offer` per §2.4.1 · price and stock management · resource-level scoping (vendor staff see only their store)
**Confirm:** Create two vendors, attach offers to each. Log in as vendor A's staff — you can see A's offers and **cannot see B's** (403).
**Est:** 2–3

### P1.3 — Catalog seeding tooling
**Builds:** CSV import script · barcode/EAN matching · `product_request` queue · duplicate detection via EAN + `pg_trgm` fuzzy match
**Confirm:** Import a 100-row CSV — counts match, duplicates flagged not created. Submit a product request, approve it, see the offer attach automatically.
**Est:** 2–3 · *Enables C1 catalog work to start in parallel*

### P1.4 — Search
**Builds:** Typesense · index sync from catalog (≤10s freshness) · **synonym/transliteration table, ops-editable** · stock-aware ranking · zero-result handling
**Confirm:** Search `atta`, `aata` and `आटा` — all return the same product. An out-of-stock offer ranks **below** in-stock ones. Add `kanda → onion` to the synonym table without a deploy — search `kanda` now finds onions. Search gibberish — get the zero-result fallback, not an error.
**Est:** 3–4

### P1.5 — Customer PWA shell
**Builds:** Next.js PWA · layout, bottom nav · home, category, listing, PDP · i18n scaffolding (en + hi) · performance budget enforced in CI
**Confirm:** Open it on your actual phone. Browse categories, search, open a product. Unit, price, per-unit price (₹/kg), veg mark and Legal Metrology declarations all visible. Switch language — UI changes. LCP under 2.5s on 4G.
**Est:** 3–4

---

## PHASE 2 — Ordering → 🎯 V0

### P2.1 — Cart
**Builds:** Cart state, unit-aware quantity steppers, persistence, totals, MOV and free-delivery progress
**Confirm:** Add items on your phone. Close the browser. Reopen — cart intact. Quantity steppers respect the product's unit (kg vs piece). Totals arithmetic is correct to the paisa.
**Est:** 2

### P2.2 — Serviceability & slots
**Builds:** Addresses · PostGIS polygons · address→store resolution · `slot_definition` / `slot_instance` · atomic capacity decrement · cutoffs
**Confirm:** Add an address inside your test polygon — slots appear. Add one outside — "not serviceable" with waitlist capture. Book slots until one is full — it greys out and cannot be selected. Book after cutoff — slot unavailable.
**Est:** 3–4

### P2.3 — Checkout & order creation (COD)
**Builds:** Checkout orchestration: address → slot → substitution preference → COD → review → place · order + order_line creation · fee calculation
**Confirm:** Place a COD order end to end on your phone. Order exists in the database with correct line items, fees and total. The order number appears on screen and in order history.
**Est:** 3–4

### P2.4 — Order state machine
**Builds:** Canonical states per §2.6 as a **declarative transition table** · guards · side effects · events · role-specific labels
**Confirm:** Drive one order through every legal transition via API. Attempt an illegal one (PACKED → AWAITING_VENDOR) → **rejected**. The same order shows different labels to customer / vendor / rider.
**Est:** 2–3

### P2.5 — Vendor WhatsApp order flow ⚙ mock-first
**Builds:** Notification module with a channel interface · WhatsApp templates from §1.9.3 · accept/reject/packed/handover with quick replies · **mock channel writes to console + a test UI**
**Confirm:** Place an order → vendor "receives" the ORDER_NEW message → tap Accept → order status changes and the customer sees it. Ignore it past SLA → auto-reminder fires, then auto-cancel.
**Est:** 3–4 · *Real WhatsApp swapped in when B1 completes*

### P2.6 — Order tracking (customer)
**Builds:** Status timeline with §2.6.3 labels · push/in-app notifications on transitions · order history · order detail
**Confirm:** With two devices — act as vendor on one, watch the customer screen update on the other. Every status change produces a notification.
**Est:** 2

### P2.7 — Reorder & Your Usual Basket
**Builds:** Buy Again list · **usual-basket heuristic (SQL: item frequency × median repurchase interval)** · one-tap add-all · the three §2.17.2 interfaces with rule implementations
**Confirm:** Place three orders with overlapping items. Home screen shows "Your usual basket" containing the repeated items with sensible quantities — **above the fold**. One tap adds them all to cart.
**Est:** 2–3 · *Rules R3 and G6*

> ## 🎯 MILESTONE — V0
> A real customer can order from a real kirana, the vendor is notified on WhatsApp, fulfils it, and takes cash on delivery. **You could run a pilot from here.**
> **Gate:** place 5 real orders end to end with a friendly vendor before starting Phase 3.

---

## PHASE 3 — Inventory & Payments

### P3.1 — Inventory modes & reservations
**Builds:** Three `inventory_mode`s per §1.9.2 · reservation at checkout initiation · optimistic locking + retry · TTL + sweeper · idempotency keys
**Confirm:** Set an offer to `quantity` with **1 unit in stock**. Two browsers reach checkout simultaneously — **exactly one succeeds**, the other gets a clean out-of-stock message. Abandon a checkout — stock returns after the TTL. Replay the same reserve call with the same idempotency key — stock decrements **once**.
**Est:** 3–4 · *Rule R4*

### P3.2 — Payment gateway (UPI) ⚙ mock-first
**Builds:** `payment` module · UPI intent + collect · webhook handling with signature + replay protection · auth/capture · server-side verification
**Confirm:** Pay ₹1 in the gateway sandbox — order moves to paid. Block the webhook and pay again — the reconciliation job recovers the order within its interval. Replay a captured webhook — **ignored, not double-processed**.
**Est:** 3–4 · *Blocked by B3 for the real leg; sandbox is enough to build*

### P3.3 — Payment failure recovery **+ the pay screens**
**Builds:** Retry with alternative app · smart payment link via notification channel · COD conversion for trusted customers · TTL-linked cancellation · **the customer screens for all of it** — a recovery block on the order page and the public `/pay/:token` link page
**Confirm:** Force a payment failure. Receive the recovery link. Complete payment through it — the same order completes, no duplicate created. Let it expire instead — order cancels and the reservation releases.
**Est:** 2 · *Screens added for the same reason P2.6 absorbed the ordering ones: the confirmation test is not runnable without them*

### P3.4 — COD risk & confirmation
**Builds:** Rule-based scoring (§2.10.4) · four risk bands · WhatsApp/OTP confirmation · **ops-configurable thresholds without deploy** · audit log · a fourth scheduled sweep to close the confirmation window
**Confirm:** Place a low-value COD order — auto-confirms. Place one above the threshold — confirmation required before the vendor sees it. Change the threshold in config — behaviour changes with **no deploy**. Every decision appears in the audit log.
**Est:** 3

### P3.5 — Refunds & cancellations **+ the refund screens**
**Builds:** Cancellation windows per §1.8.1 · full and partial refunds · refund routing · customer-facing refund status · the cancellation cost shown *before* the tap
**Confirm:** Cancel before vendor acceptance — refund initiated automatically. Attempt to cancel while out for delivery — **blocked**. Issue a partial refund — amounts correct, customer sees the status and expected date.
**Est:** 3

---

## PHASE 4 — Grocery Mechanics

### P4.1 — Substitutions
**Builds:** Preference per order + saved default · picker OOS flow · ranked substitute suggestions (rules) · propose/accept/reject with timeout fallback · price-delta rules · partial refund on rejection
**Confirm:** Vendor marks a line out of stock. With preference *Ask me* → you get the prompt with options; accept → order updates, price adjusts, never charges more than the original. With *Refund that item* → line removed, refund issued. Ignore the prompt → the saved preference applies on timeout.
**Est:** 4–5 · *Rule G7*

### P4.2 — Variable weight
**Builds:** `is_variable_weight` handling · tolerance band shown pre-purchase · authorise upper bound · picker weight entry · capture actual / refund delta · COD recompute and round · invoice on actual
**Confirm:** Order 1 kg tomatoes prepaid. Vendor enters 0.94 kg. **Charge adjusts down**, the difference is refunded or captured correctly, and the invoice shows 0.94 kg. Repeat as COD — the rider's collectable amount updates and the customer is told before dispatch. Enter 1.3 kg (outside tolerance) → **consent is requested first**.
**Est:** 4–5 · *Rule G7 · depends on P3.2 auth/capture*

### P4.3 — Perishables, batches & recall
**Builds:** Batch, mfg and expiry on offers · FEFO picking order · minimum shelf life on delivery · **recall workflow**
**Confirm:** Stock two batches with different expiries — the picking list shows the earlier-expiry one first. Set a short-dated batch below the shelf-life threshold — it delists. Trigger a recall on a batch — every affected order is listed and a notification list is produced.
**Est:** 2–3

---

## PHASE 5 — Money Infrastructure

### P5.1 — Ledger
**Builds:** `ledger_account` / `ledger_entry` per §2.4.4 · postings on every financial event · **balance invariant in tests and a nightly integrity job**
**Confirm:** Run a mixed set — prepaid delivered, COD delivered, full refund, partial refund, cancellation. Run the integrity job: **total debits equal total credits.** Deliberately post an unbalanced entry — it is **rejected**, not stored.
**Est:** 3–4 · *Rule R5*

### P5.2 — Tax & invoicing
**Builds:** GST computation from HSN/rate · tax-inclusive display · **per-vendor invoice PDF under the vendor's GSTIN** · credit notes on refunds and substitutions · invoice generated post-weighing
**Confirm:** Download an invoice — GST arithmetic correct, vendor's GSTIN shown (not the platform's), all statutory fields present. Refund an item → credit note issued. For a variable-weight order, the invoice shows **actual** amounts.
**Est:** 4–5 · *Verify output with your CA (B6) before relying on it*

### P5.3 — Settlement
**Builds:** T+3 / T+7 cycles · payout computed **from ledger balances** · commission, TCS, TDS deductions as effective-dated config · holdback and dispute reserve · vendor statement
**Confirm:** Run a settlement for a test week. Vendor statement — opening balance, orders, deductions, adjustments, payout, closing — **ties to the ledger to the rupee**. Change the TCS rate in config → next run reflects it, prior runs unchanged.
**Est:** 3–4

### P5.4 — COD cash reconciliation
**Builds:** `cod_cash_in_transit` per rider · deposit recording · bank statement import adapter · matching · **shortfall detection and escalation**
**Confirm:** Simulate three COD collections and one deposit. The unreconciled balance equals exactly the undeposited amount. Skip a deposit past the deadline → **shortfall raised automatically with the correct figure.** Deposit against the wrong reference → exception queue, not silent acceptance.
**Est:** 3–4

---

## PHASE 6 — Fulfilment

### P6.1 — Delivery provider abstraction & assignment
**Builds:** `FulfilmentProvider` interface (§2.9.1) · `VendorSelfDelivery` implementation · `ThirdPartyAggregator` ⚙ mock-first · assignment on packed · fallback on vendor decline
**Confirm:** Order reaches PACKED → assignment created against vendor self-delivery. Vendor declines → **3PL mock takes it automatically** with no manual step.
**Est:** 3

### P6.2 — Rider PWA & proof of delivery
**Builds:** Rider role and auth · assigned orders · navigation deep-link · **delivery OTP** · COD collected confirmation · end-of-day cash summary · location retention limits
**Confirm:** On a second phone, log in as rider, see the assignment, navigate, enter the delivery OTP the customer reads out — order completes. COD amount matches the post-weighing figure. Wrong OTP → rejected. Location data purged after the audit window.
**Est:** 3–4

### P6.3 — Failed delivery & RTO
**Builds:** Failure reasons · retry attempt · RTO flow · stock return to vendor · refund path · cost allocation
**Confirm:** Mark a delivery failed → retry offered → mark failed again → RTO initiated, refund follows §1.8, ledger posts the RTO cost to the party defined in the vendor agreement.
**Est:** 2–3

---

## PHASE 7 — Vendor & Admin Depth

### P7.1 — Vendor PWA dashboard
**Builds:** Today view · order queue by SLA urgency · picking list · weight entry · one-tap OOS · catalog search + barcode add · inventory modes · slot capacity · money statement
**Confirm:** **Run a full day of test orders using only the dashboard — no WhatsApp.** Usable one-handed on a phone. Every action available in WhatsApp is available here.
**Est:** 4–5

### P7.2 — Admin console
**Builds:** Vendor approvals with licence-expiry checks · live order board with exception filters · COD risk queue · disputes and refund approvals with limits · catalog governance · synonym editor · **config without deploy** · dual approval on money actions
**Confirm:** Approve a vendor. Change a COD threshold, a delivery fee and a serviceability polygon — **all without a deploy**. Attempt a payout above your limit → **dual approval required.** Every change appears in the immutable audit log.
**Est:** 4–5

### P7.3 — Vendor analytics & SLA scoring
**Builds:** Vendor score per §6.4 · acceptance/OOS/on-time metrics · ranking effect · SLA breach tracking and interventions
**Confirm:** Simulate SLA breaches for a vendor — score drops, their offers rank lower in search, and the intervention ladder triggers at the defined thresholds.
**Est:** 2–3

---

## PHASE 8 — Hardening & Launch Readiness

### P8.1 — Abuse prevention & API hardening
**Builds:** OTP rate limits (5/hr, 15/day per phone; per-IP) with backoff and CAPTCHA escalation · global rate limiting · idempotency audit across all mutating endpoints · webhook replay protection · coupon abuse controls · bot/scrape defence
**Confirm:** Request 6 OTPs for one number in an hour → **blocked**. Hammer search from one IP → throttled, not crashed. Replay every payment webhook → no double-processing. Attempt to reuse a single-use coupon → rejected.
**Est:** 3–4 · *Rule R4*

### P8.2 — DPDP features
**Builds:** Itemised consent at signup with versioning · consent management in settings · **data export** · **account deletion honouring tax retention** · grievance officer contact and ticket SLA
**Confirm:** Sign up — consent notice is itemised and recorded with its version. Withdraw one consent — as easy as granting it. Download your data — machine-readable and complete. Delete your account — personal data erased or irreversibly anonymised, **while order records required for tax are retained**.
**Est:** 4–5 · *Confirm the retention/erasure boundary with counsel (C3)*

### P8.3 — Notifications complete
**Builds:** Real WhatsApp BSP swap-in · DLT-registered SMS · push · email · preference centre · quiet hours · fallback chains · delivery receipt log
**Confirm:** Receive each event on its intended channel. Opt out of SMS — **no SMS arrives**, but critical order messages still reach you via another channel. Trigger a non-critical notification at 23:00 — held until quiet hours end.
**Est:** 2–3 · *Blocked by B1, B2*

### P8.4 — Load & chaos testing
**Builds:** Load scenarios against §1.4.1 (peak ordering burst, search under catalog load, slot contention) · chaos drills per §2.15
**Confirm:** **150 RPS sustained within the §1.4.2 SLOs.** 50 concurrent checkouts on 5 units of stock → exactly 5 succeed. Kill search → browse and reorder still work. Kill the gateway → COD still works and prepaid fails gracefully. Kill WhatsApp → orders still flow via fallback channel.
**Est:** 3–4

### P8.5 — Accessibility audit
**Builds:** WCAG 2.1 AA remediation across **all four surfaces** · axe in CI · manual audit
**Confirm:** Complete a full checkout using **keyboard only**. Complete one using TalkBack. Contrast passes on every screen. Status changes are announced. No meaning conveyed by colour alone.
**Est:** 2–3

### P1.6 — Deploy the customer PWA to Cloud Run
> **Standing rule R8: everything runs on GCP.** P0.5b provisioned Cloud Run for the API only. The PWA builds and is CI-verified, but has nowhere to run — so it is the one delivered component with no GCP home.

**Builds:** Cloud Run service for `web-customer` · its own Dockerfile (Next.js standalone output) · `NEXT_PUBLIC_API_BASE` pointed at the API service · deploy job in CI alongside the API · Terraform for both

**Confirm:** Push to `main` — the PWA deploys itself. Open the Cloud Run URL and browse a real product from the staging catalog.

> Until P8.6 there is no real authentication, so this stays IAM-private like the API (§P0.5b). It becomes public with P8.6, not before.

**Est:** 1–2

### GCP surface checklist *(rule R8)*
Every component, and where it lives. A row without a GCP home is not finished.

| Component | GCP home | Status |
|---|---|---|
| API | Cloud Run | ✅ deployed |
| Database | Cloud SQL (PostgreSQL 16 + PostGIS) | ✅ |
| Migrations | Cloud Run job | ✅ |
| **Scheduled work** (§1.9.4 SLA sweep) | **Cloud Run job + Cloud Scheduler** | ✅ P2.5a |
| **Reservation expiry** (§2.5, every 60 s) | **Cloud Run job + Cloud Scheduler** | ✅ P3.1 |
| **Payment reconciliation** (§2.10.3, every 5 min) | **Cloud Run job + Cloud Scheduler** | ✅ P3.2 |
| **Webhook front door** (public, signature-gated) | **Cloud Run** (`freshkirana-staging-webhooks`) | ✅ P3.2 |
| Container images | Artifact Registry, built by Cloud Build | ✅ |
| Secrets | Secret Manager | ✅ |
| Deploy identity | Workload Identity Federation | ✅ |
| **Customer PWA** | **Cloud Run** (`freshkirana-staging-web`) | ✅ P1.6 |
| Redis | Memorystore | ⏸ provisioned-but-off until P3.1 needs it |
| Rider PWA | Cloud Run | ☐ with P6.2 |
| Vendor PWA | Cloud Run | ☐ with P7.1 |
| Admin SPA | Cloud Run | ☐ with P7.2 |
| Object storage (product images) | Cloud Storage | ☐ when images land |

### P8.6 — Auth hardening *(deferred from P0.3 on 2026-08-12)*
> **This part must not be skipped.** P0.3a deliberately shipped identity with a development-only login and no real authentication ceremony. Until this part lands, **the product cannot go to production** — there is no way for a real user to authenticate.

**Builds:** Real OTP send and verify · SMS/WhatsApp delivery via the notification module · JWT access + **rotating refresh tokens in HttpOnly cookies with reuse detection** · session list and remote revoke · OTP rate limiting (5/hr, 15/day per phone; per-IP) with backoff and CAPTCHA escalation · **MFA (TOTP) for admin, finance and fleet-manager roles** (§3.1) · removal of the dev login path from all non-development builds

**Confirm:** Register with a real phone, receive an OTP, log in. Refresh rotates and the old token is rejected. Reuse a revoked refresh token → the whole token family is revoked. Request 6 OTPs in an hour → blocked. Admin login without TOTP → denied. Build for production → `/dev/login-as` returns 404 and the handler is absent from the bundle.

**Est:** 3–4 · *Pairs naturally with P8.1 abuse prevention*

### P8.7 — Launch readiness review
**Builds:** Runbooks for §6.2 exceptions · incident severity + on-call · **backup restore drill** · monitoring dashboards · seed data for production
**Confirm:** **Restore staging from a backup and verify data integrity.** Walk each §6.2 exception through its runbook. Trigger a test alert — it reaches you.
**Est:** 2–3

> ## 🎯 MILESTONE — MVP COMPLETE
> Matches §7.0 of the specification. Entry condition for P0 Alpha (§1.11).

---

# Part III — Progress Tracker

**Keep this current.** It is the handoff between sessions.

**Status key:** ☐ not started · ◐ in progress · ⏳ awaiting confirmation · ✅ confirmed · ⏸ blocked

| Phase | Part | Title | Status | Confirmed | Notes |
|---|---|---|---|---|---|
| 0 | P0.1 | Monorepo, contracts, CI | ✅ | 2026-08-12 | `e971274` · 23 tests · push pending `gh auth login` |
| 0 | P0.2 | Database & module skeleton | ✅ | 2026-08-15 | `e919f88` · CI green · boundary fixture verified both directions |
| 0 | P0.3a | Identity model & plumbing | ✅ | 2026-08-16 | `7250895` · CI green, 10 e2e ran. Dev login only — real auth is P8.6 |
| 0 | P0.4 | Observability & analytics ingest | ⏳ | | `b1ecb93` · CI green · 81 tests · R1 ingest path live |
| 0 | P0.5a | Containerisation | ✅ | 2026-08-16 | `f4ea895` · CI green (3 jobs) · image builds, boots, refuses production |
| 0 | P0.5b | Cloud provisioning & staging | ✅ | 2026-08-17 | Applied to `freshkirana-staging-mm`. Auto-deploy from `main` green end to end |
| — | 🎯 | **PHASE 0 COMPLETE** | ✅ | 2026-08-17 | 5 parts · 81 tests · staging live and private |
| 1 | P1.1 | Master catalog | ✅ | 2026-08-17 | `6fe5eb4` · CI green, deployed · D1 master side |
| 1 | P1.2 | Vendors & offers | ✅ | 2026-08-18 | `ade2a4f` · CI green, deployed · D1 offer side + §3.2 scoping live |
| 1 | P1.3 | Catalog seeding tooling | ✅ | 2026-08-18 | `3a1bc32` · CI green, deployed · unblocks C1 |
| 1 | P1.4 | Search | ✅ | 2026-08-18 | `95a3e28` · CI green, deployed · Postgres engine, Typesense on §2.1.2 trigger |
| 1 | P1.5 | Customer PWA shell | ⏳ | | `40e0a07` · CI green · 182 tests · 103.9 KB of the 200 KB budget |
| 1 | **P1.6** | **Deploy the customer PWA to Cloud Run** | ✅ | 2026-08-18 | 🌐 Rule R8 satisfied · `1ae5611` · CI deploys both services |
| — | 🎯 | **PHASE 1 COMPLETE** | ✅ | 2026-08-18 | 6 parts · 182 tests · API + storefront both live on GCP |
| 2 | P2.1 | Cart | ⏳ | | `3c90712` · CI green, deployed · 228 tests · D2 enforced with a resolvable 409 · anonymous basket claimed on sign-in · re-priced from the live offer |
| 2 | P2.2 | Serviceability & slots | ⏳ | | `589b7bc` · CI green, deployed · 294 tests · PostGIS live · 20 racing bookings → exactly 5 · fixed a latent PATCH bug that blocked vendor approval and product publishing |
| 2 | P2.3 | Checkout & order creation | ⏳ | | `486b445` · CI green, deployed · 333 tests · COD end to end · slot booking + order + cart conversion in one transaction · GST extracted per line |
| 2 | P2.4 | Order state machine | ⏳ | | `6450350` · CI green, deployed · 372 tests · declarative table, guards, effects, §2.6.3 labels · audit trail per move |
| 2 | P2.5 | Vendor WhatsApp flow ⚙ | ⏳ | | `4f6f77c` · CI green, deployed · mock channel + idempotent webhook · SLA reminder and auto-cancel |
| 2 | P2.5a | **Scheduled SLA sweep** | ⏳ | | `1b1b4fa` · CI green · 403 tests · Cloud Run job + Cloud Scheduler, verified executing on GCP |
| 2 | P2.6 | Order tracking **+ customer ordering screens** | ⏳ | | `b68995e` · CI green, deployed · 421 tests · timeline, notifications, and the cart/checkout/orders UI that P2.1–P2.3 left as API-only |
| 2 | P2.7 | Reorder & Usual Basket | ⏳ | | `46fc3d8` · CI green, deployed · 453 tests · the §0.3 wedge, live · rule R3 satisfied in full |
| — | 🎯 | **V0 MILESTONE** | ⏳ | | **All 7 parts built and deployed.** Gate: place 5 real orders end to end with a friendly vendor |
| 3 | P3.1 | Inventory modes & reservations | ⏳ | | `198c29f` · CI green, deployed · 480 tests · oversell closed · sweeper running every minute on GCP |
| 3 | P3.2 | Payment gateway (UPI) ⚙ | ⏳ | | `d9a6035` · CI green, deployed · 501 tests · B3 decided: **Razorpay** · real signature scheme, replay protection, reconciliation job live on GCP |
| 3 | P3.3 | Payment failure recovery **+ the pay screens** | ⏳ | | `3720b14` · CI green, deployed · 549 tests · retry, WhatsApp link, COD conversion, TTL cancellation · **reversed P3.2's cancel-on-failure** and made the idempotency key per attempt |
| 3 | P3.4 | COD risk & confirmation **+ the confirm screens** | ⏳ | | `3a52301` · `e713b79` · `5d0d66c` · CI green, deployed · 606 tests · four bands, WhatsApp + OTP, thresholds in a table (no deploy), full audit log · sweep verified executing on GCP · **fixed three shipped defects: prepaid orders never reached the store, three scheduled jobs ran months-old images, and the confirmation itself could be bypassed from the app** |
| 3 | P3.5 | Refunds & cancellations **+ the refund screens** | ⏳ | | `6da2613` · 645 tests · §1.8.1 windows proven, automatic refund on cancel, partial refunds, customer-facing status · **fixed a shipped defect: `order.payment_status` had never been written since P2.3** |
| — | 🎯 | **PHASE 3 COMPLETE** | ⏳ | | 5 parts + 1 fix commit · 645 tests · inventory holds, UPI payments, failure recovery, COD risk, refunds · **four shipped defects found and fixed while building on top of them** |
| 4 | P4.1 | Substitutions | ☐ | | |
| 4 | P4.2 | Variable weight | ☐ | | |
| 4 | P4.3 | Perishables & recall | ☐ | | |
| 5 | P5.1 | Ledger | ☐ | | |
| 5 | P5.2 | Tax & invoicing | ☐ | | Needs B6 |
| 5 | P5.3 | Settlement | ☐ | | |
| 5 | P5.4 | COD cash reconciliation | ☐ | | |
| 6 | P6.1 | Delivery abstraction ⚙ | ☐ | | |
| 6 | P6.2 | Rider PWA & POD | ☐ | | |
| 6 | P6.3 | Failed delivery & RTO | ☐ | | |
| 7 | P7.1 | Vendor PWA dashboard | ☐ | | |
| 7 | P7.2 | Admin console | ☐ | | |
| 7 | P7.3 | Vendor analytics & SLA | ☐ | | |
| 8 | P8.1 | Abuse prevention | ☐ | | |
| 8 | P8.2 | DPDP features | ☐ | | Needs C3 |
| 8 | P8.3 | Notifications complete | ☐ | | Needs B1, B2 |
| 8 | P8.4 | Load & chaos testing | ☐ | | |
| 8 | P8.5 | Accessibility audit | ☐ | | |
| 8 | **P8.6** | **Auth hardening — deferred from P0.3** | ☐ | | 🔒 **BLOCKS PRODUCTION.** Real OTP, refresh rotation, rate limits, admin MFA |
| 8 | P8.7 | Launch readiness | ☐ | | |
| — | 🎯 | **MVP COMPLETE** | ☐ | | |

---

# Part IV — Decision Log

Record every decision made during the build that isn't already in the spec. This is what stops us re-litigating settled questions in later sessions.

| Date | Part | Decision | Rationale |
|---|---|---|---|
| 2026-08-12 | — | TypeScript / NestJS for the core (OD-1) | §2.3 |
| 2026-08-12 | — | No AI in the MVP; seam held open (OD-11) | §2.17 |
| 2026-08-12 | — | Build sequentially by part with a manual confirmation gate on each | This document |
| 2026-08-12 | P0.1 | npm workspaces, Vitest (SWC transform), trunk-based on `main`, docs committed to the repo | Proposal approved; fewest tools, fastest feedback loop |
| 2026-08-12 | P0.2 | One PostgreSQL schema per module; boundaries enforced by dependency-cruiser + a schema-ownership script | Makes "a module owns its tables" mechanically checkable and §2.1.2 extraction cheap |
| 2026-08-12 | P0.2 | PostGIS image from day one | §2.8 needs polygons; adding the extension to a live database later is a migration |
| 2026-08-12 | **P0.3** | **Split: identity model now (P0.3a), authentication ceremony deferred to P8.6** | OTP/login friction slows every subsequent part's testing. The model and §3.2 resource scoping cannot be deferred — every Phase 1–2 table keys off identity, and retrofitting scoping means re-auditing every query written in between |
| 2026-08-16 | P0.5 | Split into P0.5a (containerisation, cloud-agnostic) and P0.5b (provisioning) | Kept the build moving while decision A2 was open |
| 2026-08-17 | **A2** | **GCP, `asia-south1` (Mumbai)** — Cloud Run + Cloud SQL | Scale-to-zero keeps idle cost near nil during the build; Mumbai is the simplest DPDP posture (§3.6) |
| 2026-08-17 | P0.5b | **Local development runs against Cloud SQL, not a local container** | Removes the Docker Desktop dependency, which failed repeatedly, and eliminates "works locally / breaks deployed" drift. Staging takes a public IP with no authorized networks, reached only through the Cloud SQL Auth Proxy (IAM-authenticated, TLS, `ENCRYPTED_ONLY`). Production keeps `db_public_ip = false` |
| 2026-08-17 | P0.5b | **Images are built by Cloud Build, not local Docker** | No local Docker dependency at all; also faster and closer to how CI builds |
| 2026-08-18 | P1.2 | **No cross-schema foreign keys** — modules validate references through each other's `contracts.ts` | An FK across schemas couples a module to another's internals (§2.1.1) and makes §2.1.2 extraction expensive. The trade is explicit: database-level referential integrity is given up in exchange for boundaries that hold |
| 2026-08-18 | P1.3 | Cross-module workflows live in the **admin module** | Approving a product request touches catalog *and* offer, and offer already depends on catalog — catalog calling offer would close a cycle. This is what §2.2 means by admin as orchestration |
| 2026-08-18 | — | **Everything runs on GCP — standing rule R8.** Backend, database, every frontend surface, jobs, images, secrets | Confirmed by Shubham. No delivered component may depend on a local machine, and none is finished until it has a GCP home. Tracked in the GCP surface checklist in §7.4 |
| 2026-08-18 | **P1.4** | **Search engine is PostgreSQL + `pg_trgm`, not Typesense** — deviating from §2.7.1 | Tuning a dedicated engine against an empty catalog is premature, and the hard part (Indian-language expansion) is engine-independent. §2.1.2 already names the trigger to revisit: catalog > 200K offers, or search p95 > 200 ms. Built behind a projection table so the swap is an implementation, not a rewrite |
| 2026-08-18 | **P2.1** | **The cart is re-priced from the live offer on every read; the stored price only flags a change** | Grocery prices move daily. Honouring a snapshot either shorts the vendor or overcharges the shopper, and neither is recoverable at checkout. The shopper sees the current price with a "price changed" marker instead of a surprise at payment |
| 2026-08-18 | P2.1 | A second vendor is refused with a **409 carrying both vendor ids**, not by silently switching or merging | D2 makes one order one store, so this conflict is real and will happen often. The UI can only offer "switch shop and start again" if the response says what it is switching between; a 409 with a bare message forces the client to guess |
| 2026-08-18 | P2.1 | On sign-in the **anonymous basket wins**; any older account basket is abandoned, not merged | Merging two single-vendor baskets from different shops has no correct answer under D2, and silently dropping half is worse than either. The anonymous basket is what the shopper was looking at one second ago |
| 2026-08-18 | P2.1 | Unavailable lines stay **visible but excluded from the total** | Silently removing a sold-out line lets a shopper reach checkout believing they ordered something they did not — the failure surfaces at the door instead of on the screen |
| 2026-08-18 | P2.1 | Order-level fees live in a **`pricing` module**, taking a vendor id from the first call | Cart, checkout and settlement must agree on what a basket costs; two implementations eventually disagree. The signature is the expensive part to change once three callers exist, even while every vendor gets the same answer |
| 2026-08-18 | **P2.2** | **No geocoding provider.** The client supplies latitude and longitude from a map pin or the device | A geocoding API is a paid program dependency, not a build decision. The seam is one insert: whoever adds it fills two columns that already exist. Recorded in Deferred Items |
| 2026-08-18 | P2.2 | Service areas are **`geography`, not `geometry`**, with polygon preferred and radius as a fallback | `geography` measures metres on the spheroid; `geometry` measures degrees, and a degree of longitude is 111 km at the equator and 0 at the pole — a "5 km radius" would mean different things in Chennai and Srinagar. The radius fallback lets a vendor be live the day they sign up |
| 2026-08-18 | P2.2 | A vendor with **no service area serves nobody** | Failing closed. The alternative is promising delivery to an address no rider can reach, discovered at the door |
| 2026-08-18 | P2.2 | Slot instances are **materialised lazily on read**, not by a nightly job | A scheduler is a thing to run, monitor and back-fill after every outage. The unique key on (definition, date) makes concurrent generation harmless, so a slot exists exactly when somebody looks for it |
| 2026-08-18 | P2.2 | **`FULL` is derived** from booked against capacity, deviating from the §2.8.2 sketch that stores it | Storing it is a second source of truth that every release path must remember to undo. Stored status carries only what a person decided: OPEN, CLOSED, BLACKOUT |
| 2026-08-18 | P2.2 | Capacity is **frozen into the instance** at materialisation | Raising a definition's capacity must not silently change a day people have already booked into, and lowering it must never strand orders that exist |
| 2026-08-18 | P2.2 | **e2e test files run sequentially** (`fileParallelism: false`) | Every e2e file boots the app against the same Cloud SQL database with a pool of up to 10; a dozen at once exceeds the instance's connection limit, and the loser gets a 5-second connect timeout that looks like a flake. Also removes a class of cross-file interference on shared data |
| 2026-08-18 | **P2.3** | **Everything is snapshotted onto the order** — address, slot window, product names, prices, HSN codes, GST rates | A customer may delete an address tomorrow and a vendor may re-price tonight. An order that changes retroactively cannot be supported, invoiced or audited, and §2.11 settlement is computed against what was actually agreed |
| 2026-08-18 | P2.3 | **The cart id is unique on the order**, and that is what makes placing idempotent | Two submissions in flight both see an open cart and both reach the write. The index decides it: the loser's transaction rolls back entirely, releasing the slot place it took. A service-level check alone cannot do this |
| 2026-08-18 | P2.3 | **GST is extracted from the price, never added to it** — per line, at each line's own rate | Indian retail prices are GST-inclusive. Adding would charge ₹535.50 for a ₹510 basket. A real basket mixes 5% atta with nil-rated vegetables, so one blended rate misstates every invoice |
| 2026-08-18 | P2.3 | Order numbers come from a **Postgres sequence** — `FK-260818-00042` | `count(*) + 1` races and would hand two simultaneous orders the same receipt. `nextval` never reuses a value; a gap is harmless, a collision is a support case. The format survives being read over the phone, which a UUID does not |
| 2026-08-18 | P2.3 | **Checkout owns no tables.** It orchestrates other modules' contracts | The sequence "validate → book → write → close" is what payments (P3.2) and reservations (P3.1) change. Keeping it in one module with no schema means those parts extend a workflow instead of rewriting five modules |
| 2026-08-18 | P2.3 | The review screen returns **every blocker at once**, not the first | Fixing one problem only to discover the next is how a two-minute fix becomes an abandoned basket |
| 2026-08-18 | P2.3 | e2e suites place fixtures at **per-run coordinates** | The shared database accumulates real serviceable stores. Pinning every suite to the same point makes one suite's vendors crowd another's "nearest stores" list, and assertions fail for reasons unrelated to the code |
| 2026-08-18 | **P2.4** | **The state machine is a declarative table in `contracts`, and nothing else writes `order.status`** | §2.6 requires it. A status set directly is a status set with no guard, no audit row and none of the effects that were meant to accompany it — here the one that matters is releasing the slot, invisible until a store runs out of capacity it never used |
| 2026-08-18 | P2.4 | Guards and effects are **named, not functions** | The table ships to the frontends in the contracts package and must stay free of database and service dependencies. The names are also what makes the table readable as a specification |
| 2026-08-18 | P2.4 | **Ops appear on every transition** | Reality does not follow the diagram: a rider's phone dies, a store marks the wrong order packed. Denying support the ability to correct state guarantees an out-of-band `UPDATE`, which leaves no audit trail at all (§3.8) |
| 2026-08-18 | P2.4 | 403 and 409 are **different answers**: forbidden for this role, versus illegal from this state | A client that cannot tell them apart cannot decide whether to hide a button, show an error, or reload. Both responses carry what *is* allowed |
| 2026-08-18 | P2.4 | §2.6.3 labels are a **lookup**, never a status column per audience | Two columns drift into two state machines, which is precisely the mistake v1.0 of the spec made |
| 2026-08-18 | P2.4 | **`COMPLETED` is not terminal**, correcting `TERMINAL_ORDER_STATUSES` | §2.6.1 allows `COMPLETED → RETURN_REQUESTED` — customers open the bag after the rider has gone. Calling it terminal made the return path unreachable, and the customer discovers that exactly when they are already unhappy |
| 2026-08-18 | **P2.5** | **The mock WhatsApp channel records to the same `message` table the real BSP will** | A console line cannot be tapped, so the dev outbox is what makes the flow testable — and testing a different path from the one that ships tests nothing. It is also the §2.12 delivery-receipt log from day one |
| 2026-08-18 | P2.5 | The template catalogue is a **closed union**, like the analytics one | WhatsApp templates must be pre-approved by the BSP before they can be sent. A template invented at runtime is a message that silently fails in production |
| 2026-08-18 | P2.5 | The webhook is **idempotent on the provider's message id** | Providers retry; that is documented behaviour, not an edge case. "Accept" applied twice looks harmless right up until the button is "cancel" |
| 2026-08-18 | P2.5 | An SLA breach goes **`AWAITING_VENDOR → REASSIGNING → CANCELLED`**, not straight to cancelled | Keeps "the store ignored us" distinguishable from "the customer changed their mind" in the audit trail, which is what §6.4 vendor scoring reads |
| 2026-08-18 | P2.5 | The WhatsApp flow lives in **`order`**, not `notification` | The obvious home closes a cycle — and not a lint one: the module that talks to a messaging provider would also have to know what an order status means. The dependency runs one way, `order → notification` |
| 2026-08-20 | **P3.4** | ⚠️ **A captured prepaid order was never announced to the store.** Fixed in `onCaptured` | P3.2 moved the announcement from checkout to capture — its comment says so — and never landed it at capture. A paid order reached `AWAITING_VENDOR` with no shop told. The SLA sweep hid it perfectly: the store received a *reminder* for an order they had never heard of, and a breach then cancelled it. No test covered "the store is told", which is why it survived two parts |
| 2026-08-20 | **P3.4** | ⚠️ **Thresholds moved from environment variables into a table** | P2.7 read them from `process.env`, which looks like configuration and is not: on Cloud Run an env var lives in the revision, so changing one deploys a new revision. §2.10.4 asks for the opposite and asks for a reason — a pilot city tunes these weekly against its own RTO numbers, and a knob that costs a deploy is a knob nobody turns. Env vars survive as the *seed* for an environment that has never been configured |
| 2026-08-20 | P3.4 | The threshold cache has a **30-second TTL**, and that is the honest cost of "no deploy" | Reading the table per order would put a query on the checkout path for a value that changes a few times a month; caching means instances disagree until it expires. Thirty seconds is short enough that an operator watching a bad evening sees their change take hold *while they are still watching*, which is the property that matters |
| 2026-08-20 | **P3.4** | **An unconfirmed cash order waits in `PENDING_PAYMENT`.** No new status | §2.6.1 has no "confirming" state, and `PENDING_PAYMENT` already means exactly this: not released to the store, because the money question is unsettled. For prepaid that question is settled by capture; for cash by the customer saying yes. It also makes the timeout free — `PENDING_PAYMENT → CANCELLED` is already in the table with the effects that release stock and slot. An eighteenth status would have bought a better name and a second cancellation path to keep correct |
| 2026-08-20 | P3.4 | The band is decided **before the order row is written** | The opening status depends on the answer, and `AWAITING_VENDOR` cannot be walked back — "the store already saw it" is not a reversible fact. Deterministic rules are what make the preview's answer and the placement's answer agree, which is a practical argument for rules over a model quite apart from §3.8 |
| 2026-08-20 | P3.4 | Holds stay **HELD** for a cash order awaiting confirmation | Checkout used to settle them immediately because "COD has no payment step". It does now — the customer's answer is the step — and provisional holds are what let the §2.5 sweeper take the stock back from an order nobody confirms |
| 2026-08-20 | P3.4 | `CustomerReply` is a **separate vocabulary** from `VendorReply` | Both arrive on the same inbound webhook. A shared `CONFIRM`/`CANCEL` would make "who tapped this?" a question answered by guessing, and a shop owner ordering their own groceries defeats a guess by phone number. Routing lives in its own service so the dependency stays acyclic — the COD flow already depends on the vendor flow to announce |
| 2026-08-20 | P3.4 | The default medium cutoff is **25, not 20** | "First order from this account" scores exactly 20, so a cutoff at 20 puts every new customer through a confirmation on their first cash order — friction at the precise moment §0.3 is trying to win them over, on a basket usually worth less than the message. A first order becomes MEDIUM when something *else* is also true |
| 2026-08-20 | P3.4 | The OTP is stored **hashed**, and never returned by any endpoint | Six digits guarding a grocery delivery is not a bank balance, but a support person reading a live code out of a table is the start of a story that ends badly. It exists in the message that carried it and nowhere else |
| 2026-08-20 | P3.4 | Each decision **snapshots the thresholds and the inputs** | They change without a deploy, so a decision read six weeks later cannot be explained by the config as it stands today — and "why was this order blocked?" is exactly the question asked long after the fact |
| 2026-08-20 | **P3.4** | ⚠️ **E2E suites must not share `/dev/login-as` with no phone** — it returns one account for the whole database | Placement now reads the account's past, so three older suites broke at once on code that had not changed: they manufacture returned deliveries on purpose, that shared account had accumulated **17 RTOs across every run ever**, and §2.10.4 correctly started holding its cash orders. The failure looked like a P3.4 bug and was a P3.4 feature working. Each order now comes from a fresh shopper (`testing/customer.ts`) |
| 2026-08-20 | **P3.5** | ⚠️ **`order.payment_status` was never written after the order was created.** Now maintained on capture and on refund | The column has existed since P2.3 and §2.6.2 declares the whole payment axis, but nothing moved it off `PENDING` — so every prepaid order read as unpaid however thoroughly it had been paid. Invisible until something asks "how much of this money is ours?", which P3.5 does and P5's ledger will do far more sharply. Found because the refund logic returned zero for orders that were plainly paid |
| 2026-08-20 | **P3.5** | **The refund row is written before the gateway is called** | A refund the gateway accepted and we did not record is money gone with no trace — unrecoverable without reading the provider's dashboard by hand. Writing first means a crash between the two leaves a refund we owe *and know about*, which a sweep can finish. The reverse order optimises for the case that does not matter at the cost of the one that does |
| 2026-08-20 | P3.5 | The refund is **initiated from the transition**, not from each caller | There are five ways an order reaches CANCELLED — customer, store, ops, the SLA sweep, the payment-window sweep — and a refund wired into each is a refund missed by whichever path somebody forgets. §1.8.1 says "initiated automatically", and automatic means from the state machine itself |
| 2026-08-20 | P3.5 | A refund is a **row per refund**, never a running total | An order can be refunded more than once: a missing item today, an underweight line tomorrow. A total says how much went back without saying why any of it did, and cannot answer "what was this ₹80 for?" — which is the actual support question |
| 2026-08-20 | P3.5 | The customer is promised a **range of days, never a date** | The gateway controls the timing and routinely takes the long end. A precise date is a promise this system cannot keep, and a refund arriving late after one is a second failure on top of the one that caused it |
| 2026-08-20 | P3.5 | **Store credit is opt-in, and only for cash** (§1.8.2) | Prepaid money goes back down the rail it came up — refunding a card to a bank account trips money-laundering controls and is not the customer's expectation either. For cash there is no rail, so §1.8.2 allows credit *as an alternative to a refund already owed*: a stored-value instrument the customer did not choose has RBI prepaid-instrument implications, and "we kept your money as credit" is how a refund becomes a complaint |
| 2026-08-20 | P3.5 | A manual refund's idempotency key comes from an **operator-supplied reference** | Rule R4, and it cannot be derived from the order: two underweight lines on one order are two refunds, and an order-derived key would silently collapse them into one. Only the caller knows whether a resubmitted form is the same refund again |
| 2026-08-20 | P3.5 | The **cancellation fee is configuration**, default zero | §1.8.1 allows one and sets it to none in V1. Charged only from PACKED, because before that nobody has done any work — and shown *before* the confirm button, since a warning that arrives after the tap is not a warning |
| 2026-08-20 | **P3.4** | ⚠️ **The §2.10.4 confirmation could be walked around with one tap.** A cash order is now out of scope for payment recovery entirely | A held cash order sits in `PENDING_PAYMENT` with no payment attempt behind it, so P3.3's recovery block read it as a failed payment and offered "pay cash on delivery instead" — on an order that already was. That button calls `convertToCod`, which confirms the reservations and moves the order to `AWAITING_VENDOR`: the risk scoring, the code and the window, all skipped by pressing the other button. Two features each correct alone, wrong together, and only visible from the customer's screen — which is why it surfaced when somebody asked what the customer actually sees |
| 2026-08-20 | P3.4 | The order page **branches on payment method**, not on status alone | `PENDING_PAYMENT` means two different things now — a prepaid payment that failed (§2.10.3) and a cash order awaiting confirmation (§2.10.4) — and a screen that guesses from status offers buttons that are nonsense at best and dangerous at worst |
| 2026-08-20 | P3.4 | The confirmation works **without WhatsApp** | A shopper who deleted the message, or never had WhatsApp on that handset, must still be able to finish — otherwise the channel becomes a single point of failure for the order. Whichever answer lands first wins; `resolve()` is guarded on still being PENDING, so the other is a no-op rather than a contradiction |
| 2026-08-20 | P3.4 | The code field uses **`autocomplete="one-time-code"`**, and the phone is shown **masked** | The OS then offers the code from the message instead of making somebody switch apps to read six digits back. Masking to the last two is enough to recognise which handset and useless to anyone reading over their shoulder |
| 2026-08-20 | **P3.4** | ⚠️ **CI updated only one of the four scheduled jobs' images.** Found on deploy; the step now loops over all of them | Its own comment said a stale job "would quietly go on executing code from weeks ago" — and three of them were. The reservation sweep was running P3.1's build and payment reconciliation P3.2's, which means **P3.3's TTL cancellation had never once executed on GCP** despite shipping green. A stale job fails silently by doing last month's work perfectly: nothing errors, nothing alerts, and the only symptom is behaviour that quietly predates the code. Caught by comparing every job's image digest against the API's, which is now the check to repeat after any deploy that adds a job |
| 2026-08-20 | P3.4 | A new Cloud Run job takes **`bootstrap_image`**, and `ignore_changes = [image]` then pins it there | The lifecycle rule exists so CI's image updates do not fight Terraform — which also means Terraform cannot correct the image it created the job with. The first execution failed with `MODULE_NOT_FOUND`, because the bootstrap image predates the job's entry point. Same trap as P3.2's webhook service; the fix is `gcloud run jobs update` after the apply |
| 2026-08-20 | P3.4 | ⚠️ **A timed-out test skips its `afterAll`** — so a suite that mutates shared state must not be allowed to time out | The COD sweep test hit vitest's 60s limit, its threshold restore never ran, and three *later* suites failed on thresholds they never touched. The visible failures were three files away from the cause. The sweep was slow only because previous runs had left 25 unanswered confirmations behind and cancelling each releases stock and a slot — a few hundred round trips through the Cloud SQL proxy. Cloud Run reaches the database over a unix socket and the job runs every two minutes, so this is a local-development artifact; the fixture now clears its own debris |
| 2026-08-20 | P3.4 | The COD suite **restores the thresholds it changed** | They are one row shared by the whole database. A suite that ends on "large orders need confirming" leaves every later suite's cash order held for a confirmation nobody sends |
| 2026-08-20 | P3.4 | An override **requires a note** | The rules will sometimes be wrong about a real person, and the alternative to an audited override is an unaudited one: somebody editing a row directly, with no record of who or why |
| 2026-08-20 | **P3.3** | ⚠️ **A failed payment no longer cancels the order.** It stays in `PENDING_PAYMENT`, holding its stock and its slot, until the payment window closes | P3.2 shipped `onFailed` → `CANCELLED`, which is the single most expensive line in the flow: a declined UPI payment is not somebody changing their mind, it is somebody who tried to pay and was told no by a bank. Cancelling on them converts a recoverable moment into a lost order, and §2.10.3 exists precisely because that moment is recoverable. The sweeper still cancels if nothing comes of the offer, so nothing is held forever |
| 2026-08-20 | **P3.3** | ⚠️ **The payment idempotency key is per *attempt*, not per order** — `order:{id}:attempt:{n}` | P3.2's `order:{id}` made the first try the only try: the mechanism that exists to stop a double charge would have refused the retry this part is about. Attempt number is a column with a unique index on `(order_id, attempt)`, so two concurrent retries cannot both open an intent |
| 2026-08-20 | P3.3 | Only **one payment attempt is live at a time**; a retry is refused with `PAYMENT_STILL_OPEN` while the previous one is inside its window | Two open intents for one order means the customer can pay twice, and no amount of reconciliation afterwards makes that a good experience. A shopper who genuinely abandoned the first app waits out its window, which is short |
| 2026-08-20 | P3.3 | The "finish paying" link is a **public route with a long random bearer token**, not a signed-in screen | It arrives over WhatsApp and is opened on whichever device is to hand, often not the one that started the checkout. Demanding a login there loses exactly the order the link exists to save. 32 random bytes, revoked the moment a new attempt supersedes it, dead when the window closes |
| 2026-08-20 | P3.3 | The link response **says nothing about the customer** — an amount, an order number, and the handle needed to pay | The token is a bearer credential in a message anybody could forward. It buys the ability to pay, not the ability to read somebody's name, phone and address. An unknown token and an expired one get the same answer, so the route cannot be used to probe for live ones |
| 2026-08-20 | P3.3 | COD conversion goes through the **§2.17.2 `RiskScorer`**, and only `BLOCKED` refuses | The rules belong in one place — P3.4's confirmation flow reads the same bands rather than inventing a second definition of "trusted". `HIGH` is offered because §2.10.3 prefers a confirmed COD order to a lost one, and P3.4 adds the confirmation step that makes accepting it safe |
| 2026-08-20 | P3.3 | Converting to COD **kills the open payment attempt** and confirms the reservations immediately | Leaving the intent live lets the shopper pay online for an order the rider is also collecting cash for. And cash has no payment to wait for, so the holds that were provisional since checkout have nothing left to be provisional about |
| 2026-08-20 | P3.3 | **The recovery screens ship with the part**, as P2.6 established | The confirmation test says "receive the recovery link, complete payment through it". Without a screen there is nothing to receive and nothing to tap, and the part would be reported as built while the thing it exists to do could not be tried once |
| 2026-08-20 | P3.3 | The pay page **opens Razorpay Checkout and confirms nothing** | The browser is where UPI has to happen — only a browser can hand somebody to their bank's app. But a route that marked an order paid would make "paid" something a customer could assert; the signed webhook stays the only thing that settles a payment, so the worst a tampered page can do is reload early |
| 2026-08-20 | P3.3 | The **key id** goes to the storefront, the **key secret** never does | The id is published to every browser that opens a checkout, so guarding it would be theatre. Keeping the signing half out of the web service is what makes the storefront unable to create or confirm a payment — only to open one the API already made |
| 2026-08-20 | P3.3 | The message carries the **whole URL**, from `STOREFRONT_BASE_URL` | A WhatsApp template substitutes one variable, and nobody assembles a link out of a base URL they were never sent. A Terraform variable rather than the web service's own `uri`, which is a dependency cycle — the storefront already reads the API's URI for `API_BASE` |
| 2026-08-20 | P3.3 | TTL cancellation rides the **existing payment-reconciliation job**, not a new schedule | "Did a webhook go missing?" and "did this checkout get abandoned?" are the same question — what actually happened to the money — asked of the same table. A fourth scheduled job would be a second answer that can disagree with the first |
| 2026-08-20 | **P3.2** | **A second Cloud Run service is the public front door for webhooks** | Cloud Run's IAM is per service, not per route, so there is no way to open two paths on a private API. The webhook service runs the *same image* with a different entry point and an allowlist that answers nothing else; the signature on the body is what actually protects it. A test asserts every customer, cart and admin route 404s there — if it fails, the API's privacy has been undone while still looking correct in Terraform |
| 2026-08-20 | P3.2 | Terraform creates the Razorpay **secret containers, never the values** | A secret written by Terraform is a secret in the state file, and state files get copied, backed up and pasted. Versions are added out of band with `gcloud secrets versions add` |
| 2026-08-20 | P3.2 | Secret mounts are **gated on a key id being configured** | Cloud Run resolves secret versions at deploy time, so mounting a secret with no version fails the revision — an empty container created ahead of the values would break every deploy until somebody filled them |
| 2026-08-20 | P3.2 | **Credentials decide the provider**: no key id keeps the mock | A deployment missing its credentials cannot take real payments but still serves the catalog and takes COD. Refusing to boot would turn a missing secret into a total outage |
| 2026-08-19 | **B3** | **Razorpay** as the payment gateway | UPI-native, which is the primary method (§2.10.1); Route settles to vendor linked accounts from the aggregator's escrow with holds, matching the §2.11.2 T+3/T+7 cycles; WhatsApp payment links back §2.10.3's smart-link recovery; RBI-licensed domestic aggregator, which keeps FreshKirana out of needing its own PA licence. Stripe India is card-first and cross-border-oriented. **Cashfree** remains the credible alternative — the `PaymentProvider` interface makes the switch a binding change |
| 2026-08-19 | **P3.2** | ⚠️ **§2.10.2 criteria 1 and 2 are unachievable on UPI.** Auth-with-downward-capture and a ≥7-day hold are card capabilities; UPI captures immediately | So for variable weight (§1.7.1, **P4.2**) the workable pattern is **capture the estimate, refund the difference** once the picker weighs it — not authorise-then-capture-less. Recorded in `contracts/payments.ts` as `supportsAuthorisationHold`, because it constrains the product rather than one call site |
| 2026-08-19 | P3.2 | The webhook verifies the **raw request bytes**, which is why `rawBody` is enabled app-wide | The signature is over bytes. `JSON.stringify(JSON.parse(body))` can reorder keys and change whitespace — verifying a re-serialised body rejects good webhooks and can be made to accept bad ones |
| 2026-08-19 | P3.2 | A prepaid order waits in **`PENDING_PAYMENT`**, and the store is told only on capture | Telling a shop to start packing before the money arrives turns a gateway failure into the shop's loss |
| 2026-08-19 | P3.2 | Prepaid holds stay **HELD, not confirmed**, until capture | That is what lets the §2.5 sweeper take the stock back when somebody opens a payment app and never returns |
| 2026-08-19 | P3.2 | A late `failed` **cannot undo a capture** | Gateways send events out of order. The update is conditional on the payment not already being settled |
| 2026-08-19 | P3.2 | Reconciliation events are marked **`RECONCILIATION`**, not folded in with webhooks | §2.11.3 needs to know how often the webhook path is failing, and a recovered payment that looks identical to a delivered one hides exactly that |
| 2026-08-19 | P3.2 | E2E suites **fail rather than skip** when `DATABASE_URL` is set but unreachable | A suite that skips reads as green. Twice in this build a dependency-injection error — the app graph could not be constructed — was reported as "21 skipped" and nearly shipped. CI's double-run grep guard is gone with it |
| 2026-08-19 | **P3.1** | **One guarded `UPDATE`, and no `version` column** — deviating from §2.5's optimistic locking with bounded retry | Both the version column and the `SELECT … FOR UPDATE` fallback exist to make a *read-modify-write* safe, and there is no read: the guard lives in the `WHERE` clause, so Postgres checks availability and takes the stock in one statement under one row lock. Strictly stronger, with no version to carry, no retry loop to tune, and no retry storm on the one SKU everybody wants |
| 2026-08-19 | P3.1 | Stock is reserved **at checkout, never at add-to-cart** (§2.5) | A cart hold makes one shopper browsing look like stock nobody else can have. §2.5 calls it the most common way to get this wrong |
| 2026-08-19 | P3.1 | The idempotency key is **derived from the cart line**, not generated (rule R4) | A retried checkout reuses the same key and cannot take a second unit — two attempts at the same basket are the same intent. Enforced by a unique index, because a check-then-insert lets two concurrent retries both pass |
| 2026-08-19 | P3.1 | The `reservation` table is the **ledger behind `stock_reserved`** | A counter says how much is held and nothing about why, so a counter that drifts cannot be reconciled against anything. One row per hold, attributable to an order |
| 2026-08-19 | P3.1 | Stock is **consumed at `PACKED`**, not at delivery | That is when the goods physically leave the shelf. Both counters move together, or the shelf count drifts on every order |
| 2026-08-19 | **P2.7** | **The usual basket is a SQL heuristic, and stays out of the AI backlog** | §2.17.1 guardrail 1. Frequency × median repurchase interval is the whole model, and it is enough. Filing it under "AI, later" launches a generic marketplace |
| 2026-08-19 | P2.7 | **Median, not mean**, for the repurchase interval; two purchases minimum; dueness capped at 3× | Grocery histories are full of holidays and festival bulk-buys, and one drags an average far enough to ruin the prediction. A one-off in the basket every week teaches shoppers to distrust the list, and an abandoned product must not outrank the weekly atta by being enormously overdue |
| 2026-08-19 | P2.7 | Every predicted item **carries its reason** — "usually every 7 days, last bought 8 days ago" | A bare list has to be audited item by item, which costs more attention than shopping would have |
| 2026-08-19 | P2.7 | One-tap add is **partial success by design** | The basket is pinned to one store (D2) and assembled from months of buying, so some of it will be unavailable. Refusing all of it turns one tap into a puzzle; dropping it silently means finding out at the door |
| 2026-08-19 | P2.7 | The heuristic lives in `contracts` as **pure functions** | The part most likely to be tuned should be testable without a database |
| 2026-08-19 | P2.7 | `/dev/login-as` accepts a **phone**, for a test account of its own | Prediction is about one shopper's history and cannot use a customer every suite orders as. Three suites already carried workarounds for sharing it |
| 2026-08-19 | **P2.6** | **P2.6 absorbed the customer ordering screens.** The PWA had none: P2.1–P2.5 were API-only and the storefront had no per-user session | The confirmation tests for P2.1 and P2.3 say "on your phone" and were not runnable, and V0 needs a real person to place a real order. The session plumbing was needed either way, and cart/checkout screens are far cheaper alongside it than as a later part |
| 2026-08-19 | P2.6 | The Google identity token moved to **`X-Serverless-Authorization`** | Cloud Run's IAM check reads `Authorization`, which is also where the API expects the shopper's token. Sharing one header authenticates the storefront and signs the shopper out on every request |
| 2026-08-19 | P2.6 | The dev sign-in is gated by **`ALLOW_DEV_LOGIN`, not `NODE_ENV`** | The storefront runs a production build on staging. Tying it to NODE_ENV would mean either no sign-in on staging or a shipped one in production. **Must be false once P8.6 lands** |
| 2026-08-19 | P2.6 | The customer timeline is **five steps, not seventeen states** | A shopper does not care that PICKING and SUBSTITUTION_PENDING differ. Seventeen dots is a progress bar nobody can read, and it leaks the internal vocabulary the §2.6.3 labels exist to hide |
| 2026-08-19 | P2.6 | Customers are notified on **some** states, not every transition | Notifying on every internal move trains people to ignore notifications, which costs exactly the one that mattered |
| 2026-08-19 | P2.6 | The search projection carries **`bestOfferId`** | It computed the cheapest purchasable offer and discarded which one it was, so the storefront could show a price nobody could act on. Recomputing "cheapest" client-side would be a second implementation of the §2.7.3 rule that could disagree with the number on screen |
| 2026-08-18 | **P2.5a** | **Scheduled work is a Cloud Run job, not a timer and not a scheduled HTTP call** | A timer inside the API is wrong twice over on Cloud Run: the service scales to zero so it may never fire, and with several instances it fires several times. An HTTP trigger would mean a second authentication path through the guard protecting every other route — Cloud Scheduler presents a Google identity token, not one of ours — and that path becomes internet-reachable when P8.6 makes the API public. P3.1's reservation-expiry sweeper belongs beside this one |
| 2026-08-18 | P2.5 | The connection pool sets **TCP keepalives** and an idle-client error handler | Every connection runs through the Cloud SQL Auth Proxy, and proxies drop idle TCP silently — the app then checks out a client that looks fine and 500s a request that did nothing wrong. Without the error handler, one dropped idle connection takes the process down |
| | | | |

---

# Part V — Deferred Items

Anything consciously postponed during a part, so it resurfaces instead of being lost.

| Date | Part | Deferred item | Revisit at |
|---|---|---|---|
| 2026-08-19 | **P3.2** | 🔒 **Rotate the Razorpay credentials before production.** Test-mode values were shared in the build chat on 2026-08-19 and live in the gitignored `.env`. Production must use freshly issued **live** keys, created directly in Secret Manager and never pasted anywhere. The webhook secret is chosen by us, so it is rotated by editing the dashboard webhook and the secret together. | **Before production**, with the database password below |
| 2026-08-17 | P0.5b | **Rotate the staging database password.** It was pasted into a chat transcript on 2026-08-17. Accepted risk for staging: the instance has no authorized networks, so the password alone cannot connect — every path goes through the IAM-authenticated Cloud SQL Auth Proxy. Rotate with `terraform apply -replace=random_password.db`. | **Before production** |
| 2026-08-12 | P0.3 | 🔒 **Authentication ceremony** — real OTP send/verify, SMS/WhatsApp delivery, rotating refresh tokens with reuse detection, session revoke, OTP rate limiting, admin MFA, and removal of the dev-login path from non-development builds. **Until this ships there is no real authentication and the product cannot go to production.** | **P8.6** |
| 2026-08-18 | P2.2 | **Geocoding provider.** Addresses take a latitude and longitude from the client. Turning a typed address into a pin — and validating that the pin matches the text — needs a paid API (Google Maps, MapmyIndia). Until then the PWA must collect the pin from a map or the device, and a shopper who skips that has no serviceable address. | **Before pilot** — it is a program cost, not a build task |
| 2026-08-18 | P2.2 | **Store ranking beyond distance.** §2.8.1 ranks serviceable stores by distance, catalog coverage of the customer's usual basket, *and* vendor quality score. The last two do not exist yet — the usual basket is P2.7 and SLA scores are P6.3 — so resolution ranks by distance alone. The signature already takes more. | **P2.7**, then **P6.3** |
| 2026-08-18 | P2.2 | **Over-commit protection** (§2.8.2): remaining slots auto-close for a store that repeatedly breaches its pack SLA on the day. Needs SLA measurement, which arrives with the vendor flow. `setStatus(CLOSED)` is the mechanism it will call. | **P6.3** |
| ~~2026-08-18~~ | ~~P2.3~~ | ~~Stock is checked at placement, not reserved.~~ **Closed by P3.1** (`198c29f`): held atomically at checkout, with a TTL sweeper and idempotency keys. | ✅ Done |
| 2026-08-19 | **P3.2** | **Cards and wallets are refused**, though the gateway supports them. Refunds, settlement and chargebacks are not built for them (§2.10.1 marks them fast-follow) — taking money we cannot service is worse than declining it. | **After P3.5** (refunds) and **P5.3** (settlement) |
| 2026-08-19 | P3.2 | **The live Razorpay HTTP calls.** Signature verification, the webhook envelope and the whole order flow are real and tested; `createIntent` and `fetchPayment` are mocked because there is no account until B3's contracting completes. | **When B3's account lands** — swap one provider class |
| ~~2026-08-19~~ | ~~P3.2~~ | ~~§2.10.3's failure-recovery UX: retry with another UPI app, smart payment link over WhatsApp, and COD conversion for trusted customers.~~ **Closed by P3.3**: all three built, plus the TTL cancellation that stops a failed payment holding stock forever. | ✅ Done |
| 2026-08-20 | **P3.3** | **The last mile needs a real Razorpay account.** The screens open Razorpay Checkout with the key id and the intent the API created, which is exactly right — and with placeholder credentials the widget cannot load. Nothing else is stubbed: the whole arc up to "the customer taps pay" is real and tested. | **When B3's account lands** — the same swap as the live provider |
| 2026-08-20 | P3.3 | **Nobody is told when an order is cancelled for non-payment.** The sweeper cancels and releases correctly, but the customer finds out by opening the app — §2.6.3's notification set has no entry for a system cancellation. | **Before pilot** |
| 2026-08-20 | **P3.5** | **A refund never reaches COMPLETED on its own.** It is issued, recorded and reported as PROCESSING, and `markCompleted` exists — but nothing calls it: the real gateway confirms with a `refund.processed` webhook, and the mock has none to send. So a customer's refund shows "with your bank" indefinitely on staging. | **When B3's account lands**, with the webhook — plus a sweep as the safety net, exactly as payments have |
| 2026-08-20 | **P3.5** | **Store credit is routed to but not issued.** `routeFor` returns `STORE_CREDIT` when a cash customer opts in, and nothing creates the credit — there is no wallet, no balance, no expiry clock. §1.8.2 also wants counsel to confirm the structure before launch. | **P5.1** (ledger), and only after the legal review §1.8.2 asks for |
| 2026-08-20 | P3.5 | **Bank-transfer refunds have no payout path.** A cash order refunds to `BANK_TRANSFER`, which records the obligation and stops — nobody collects the customer's account details and nothing moves money. | **P5.3** (settlement), which builds the payout rail |
| 2026-08-20 | P3.5 | **§1.8.3 returns are not built.** The refund-without-return threshold, photo evidence, rider collection, and the abuse detection that routes a frequent refunder to manual review. `RefundReason.RETURN` exists and the plumbing takes it. | **P7.x**, or the first pilot week that needs it |
| 2026-08-20 | **—** | ⚠️ **The Cloud SQL Auth Proxy dropped four times in one session**, each time failing a suite mid-run with `Connection terminated` or a `requireDatabase` load error that looks exactly like a code failure. Twice it cost a full 15-minute gate. `requireDatabase` (P3.2) is what makes it legible rather than a silent skip. Worth a keepalive or a supervised restart before the next long build session. | **Before the next part** |
| 2026-08-20 | **P3.4** | ⚠️ **Nothing verifies that scheduled jobs are running the deployed image.** CI now updates all four, but if a fifth job is added and the loop is not extended, it fails exactly as silently as the three that were stale for three parts. The check is one command — compare each job's image digest against the API's — and belongs in the deploy job as an assertion, not in a person's memory. | **Next infrastructure part**, or the first time a job is added |
| ~~2026-08-20~~ | ~~P3.4~~ | ~~The COD confirmation has no customer screen.~~ **Closed the same day** (`5d0d66c`): quick-reply and OTP blocks on the order page, both working without WhatsApp. Building it is what exposed the bypass recorded above. | ✅ Done |
| 2026-08-20 | P3.4 | **Address quality, account age, distance outliers and item mix are not scored.** §2.10.4 lists seven inputs; four are implemented (value, order history, RTO history, pincode). The missing ones need data the system does not collect yet — there is no geocoding (P2.2 deferral), so "distance outlier" has nothing to measure. | **After geocoding**, and revisited when pilot RTO data exists |
| 2026-08-20 | P3.4 | **Pincode RTO rate is a manual blocklist, not a computed rate.** §2.10.4 wants the rate; with no delivery history there is nothing to compute, so ops name the pincodes. The threshold plumbing takes a rate the day one exists. | **P6.3**, alongside vendor scoring |
| 2026-08-20 | P3.3 | **The recovery link is always English.** `payUrl` hardcodes the `/en/` segment because there is no language preference on the account, though the page itself is translated. | **When account language preference lands** |
| 2026-08-20 | **P3.3** | ⚠️ **The storefront is IAM-private, so a recovery link sent to a phone returns 403.** Pre-existing since P1.6 — only the deployer service account holds `run.invoker` on `freshkirana-staging-web` — but P3.3 is the first feature that *requires* a customer to reach a page from outside the app. Opening it is a real decision, not a one-line fix: `ALLOW_DEV_LOGIN` is true on staging, so a public storefront lets anyone sign in as a test customer and place orders. **Meanwhile the whole storefront is reachable through `gcloud run services proxy freshkirana-staging-web --region=asia-south1`**, which authenticates with your own credentials — a `user` account cannot mint an audience-scoped identity token, so a bare `curl` with `print-identity-token` returns 401 and is not evidence of a broken deploy. Verified 2026-08-20: `/en/pay/<unknown>` renders the expired-link page through the proxy. | **Before the pilot**, together with `allow_dev_login=false` — or sooner behind an IP allowlist |
| 2026-08-18 | P2.3 | **Client-supplied idempotency key on `place`.** Reservations now carry keys (P3.1), but the *order* still does not: a retry after success is refused as an empty basket rather than returning the original order. Concurrent double-submits remain safe via the unique index on `cart_id`. | **P3.2**, alongside payment idempotency |
| 2026-08-18 | P2.3 | **Prepaid payment.** `place` accepts COD only and refuses other methods with a 400 rather than accepting an order nobody can pay for. | **P3.2** |
| 2026-08-18 | **P2.4** | **Automatic transitions have no trigger yet.** `PENDING_PAYMENT → AWAITING_VENDOR`, `REASSIGNING → AWAITING_VENDOR` and `DELIVERED → COMPLETED` are in the table with no actor but ops, because the things that should fire them — the payment webhook, the reassignment job, the return-window timer — do not exist. Ops can drive them by hand meanwhile. | **P3.2** (payment), **P2.5** (reassignment), **P3.5** (return window) |
| 2026-08-18 | P2.4 | **COD payment status stays `PENDING` after delivery.** §2.6.2 says a COD order moves to `COD_COLLECTED` when the rider takes the cash; that transition belongs to the cod module and its reconciliation. | **P3.4** |
| 2026-08-18 | P2.4 | **Cancellation fee from `PACKED`.** §1.8.1 allows one (default none in V1). The guard exists and is named; the fee itself needs the refund path. | **P3.5** |
| ~~2026-08-18~~ | ~~P2.5~~ | ~~Nothing fires the SLA sweep on a schedule.~~ **Closed by P2.5a** (`1b1b4fa`): a Cloud Run job executed by Cloud Scheduler every two minutes. Verified running on GCP. | ✅ Done |
| 2026-08-18 | P2.5 | **Auto-reassign to the next-best store** (§1.9.4). The breach path routes through `REASSIGNING` so the record is right, then cancels, because re-offering an order needs vendor ranking and re-vendoring an existing order. | **P6.3** (vendor scores) or a dedicated part |
| 2026-08-18 | P2.5 | **Webhook signature verification.** The mock has nothing to verify. The real channel must check the provider's signature before this route is reachable in production. | **With B1**, and gated by P8.6 |
| 2026-08-18 | P2.5 | **The remaining §1.9.3 templates** — `ITEM_OOS_PROMPT`, `SUBSTITUTION_PROPOSE`, `ORDER_PACKED_CONFIRM`, `HANDOVER_CONFIRM`, `PAYOUT_STATEMENT`, `LOW_STOCK_DIGEST` — are declared in the catalogue but not yet sent by anything. | **P4.1** (substitutions), **P5.3** (payouts), **P7.1** (digests) |
| | | | |

---

*Companion documents: the specification (`…Documentation Set.md` v2.2), the program checklist (`…Pre-Build Readiness Checklist.md`), and the original gap analysis (`…Gap Analysis & Recommendations.md`).*
