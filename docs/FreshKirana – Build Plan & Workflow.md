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

### P3.3 — Payment failure recovery
**Builds:** Retry with alternative app · smart payment link via notification channel · COD conversion for trusted customers · TTL-linked cancellation
**Confirm:** Force a payment failure. Receive the recovery link. Complete payment through it — the same order completes, no duplicate created. Let it expire instead — order cancels and the reservation releases.
**Est:** 2

### P3.4 — COD risk & confirmation
**Builds:** Rule-based scoring (§2.10.4) · four risk bands · WhatsApp/OTP confirmation · **ops-configurable thresholds without deploy** · audit log
**Confirm:** Place a low-value COD order — auto-confirms. Place one above the threshold — confirmation required before the vendor sees it. Change the threshold in config — behaviour changes with **no deploy**. Every decision appears in the audit log.
**Est:** 3

### P3.5 — Refunds & cancellations
**Builds:** Cancellation windows per §1.8.1 · full and partial refunds · refund routing · customer-facing refund status
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
| 0 | P0.5b | Cloud provisioning & staging | ⏸ | | **Blocked on A2** (cloud provider). Staging must be network-restricted until P8.6 |
| 1 | P1.1 | Master catalog | ☐ | | |
| 1 | P1.2 | Vendors & offers | ☐ | | |
| 1 | P1.3 | Catalog seeding tooling | ☐ | | |
| 1 | P1.4 | Search | ☐ | | |
| 1 | P1.5 | Customer PWA shell | ☐ | | |
| 2 | P2.1 | Cart | ☐ | | |
| 2 | P2.2 | Serviceability & slots | ☐ | | |
| 2 | P2.3 | Checkout & order creation | ☐ | | |
| 2 | P2.4 | Order state machine | ☐ | | |
| 2 | P2.5 | Vendor WhatsApp flow ⚙ | ☐ | | |
| 2 | P2.6 | Order tracking | ☐ | | |
| 2 | P2.7 | Reorder & Usual Basket | ☐ | | |
| — | 🎯 | **V0 MILESTONE** | ☐ | | 5 real orders |
| 3 | P3.1 | Inventory modes & reservations | ☐ | | |
| 3 | P3.2 | Payment gateway ⚙ | ☐ | | Needs B3 |
| 3 | P3.3 | Payment failure recovery | ☐ | | |
| 3 | P3.4 | COD risk & confirmation | ☐ | | |
| 3 | P3.5 | Refunds & cancellations | ☐ | | |
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
| | | | |

---

# Part V — Deferred Items

Anything consciously postponed during a part, so it resurfaces instead of being lost.

| Date | Part | Deferred item | Revisit at |
|---|---|---|---|
| 2026-08-12 | P0.3 | 🔒 **Authentication ceremony** — real OTP send/verify, SMS/WhatsApp delivery, rotating refresh tokens with reuse detection, session revoke, OTP rate limiting, admin MFA, and removal of the dev-login path from non-development builds. **Until this ships there is no real authentication and the product cannot go to production.** | **P8.6** |
| | | | |

---

*Companion documents: the specification (`…Documentation Set.md` v2.2), the program checklist (`…Pre-Build Readiness Checklist.md`), and the original gap analysis (`…Gap Analysis & Recommendations.md`).*
