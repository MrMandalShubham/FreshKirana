# FreshKirana – Documentation Review, Gap Analysis & Recommendations

**Reviewed document:** `FreshKirana – Scalable Grocery Marketplace Documentation Set.md`
**Review date:** 2026-08-12
**Verdict in one line:** A well-structured, genuinely India-aware foundation that covers the *browse → buy* half of the business well, but is missing the *fulfil → settle → comply* half almost entirely, and commits to an architecture that is heavier than the stated scale justifies.

---

## Part A — Strong Points We Already Cover

Rated on whether the section is **Keep as-is**, **Keep + extend**, or **Keep but correct**.

| # | Strength | Where | Why it's genuinely good | Status |
|---|---|---|---|---|
| S1 | **Correct artifact set** — PRD, Architecture, Security, Frontend, Tickets | Whole doc | These are the right five documents, in the right order, and they cross-reference each other. Most first-draft product docs are a PRD plus wishful thinking. | Keep as-is |
| S2 | **Grocery-specific product modelling** — unit-based SKUs (kg/g/l/ml/piece), perishables, inventory volatility called out in §1.1 | §1.1, §1.4 | This is the difference between a grocery doc and a generic e-commerce doc. Unit-of-measure is a first-class modelling concern and it was spotted early. | Keep + extend (see G6) |
| S3 | **"Buy Again" / Past Purchases above the fold** | §1.4, §4.2, T-012 | This is the single highest-leverage grocery UX decision and it's backed by real research (Baymard). Grocery baskets are ~70–80% repeat items. Correctly prioritised into V1 rather than "later". | Keep as-is |
| S4 | **COD treated as a first-class product surface, not an afterthought** — `cod-oms-service`, confirmation via WhatsApp/IVR/OTP, value thresholds, risky-pincode rules, audit trail | §1.4, §2.2, §3.4, T-061 | Rare and correct. COD is 40–60% of Indian grocery orders and drives RTO losses. Having a dedicated confirmation service with risk rules is a real competitive decision, not boilerplate. | Keep + extend (see G14) |
| S5 | **UPI failure recovery and fraud controls** — smart payment links, conversion to COD for trusted customers, VPA verification, "staff must not approve collect requests they didn't initiate" | §3.4, T-062 | UPI success rates hover well below 100%; a recovery path is direct revenue. The internal-controls line about collect requests shows real operational awareness. | Keep as-is |
| S6 | **Security fundamentals are correct** — short-lived JWT + refresh in HttpOnly cookie, no card storage / gateway tokenization, TLS everywhere, RBAC with **resource-level** checks (vendor staff scoped to own store) | §3.1–3.3 | The resource-level scoping line is the one most teams get wrong and then get breached on. Separating *Vendor owner* from *Vendor staff* as distinct roles is also usually missed. | Keep + extend (see G18) |
| S7 | **Dual approval + audit logging on money-moving actions** (payouts, refunds, suspensions) | §3.5 | Correct segregation-of-duties instinct. This is what stops internal fraud, which is the more common failure mode than external attack. | Keep as-is |
| S8 | **Sensible domain decomposition** — Identity / Commerce / Financial / Operations, then 14 named services | §2.1–2.2 | As a **domain map** this is clean and the boundaries are drawn in the right places. Separating `pricing` from `catalog`, and `inventory` from `catalog`, is correct. | Keep, but **re-frame as modules, not services** (see G1) |
| S9 | **Polyglot storage with right defaults** — PostgreSQL for money/orders (ACID), Redis for catalog + session cache, object storage for images, partitioning/archiving of old orders | §2.3 | The instinct to put transactional integrity where money lives and speed where reads live is correct. Order archiving being mentioned at design time is unusually mature. | Keep but correct (drop MongoDB — see G3) |
| S10 | **Observability specified as a requirement, not a phase-2 wish** — logs, metrics, traces, alerts, plus a dedicated EPIC-009 | §1.5, §2.6, EPIC-009 | Tracing across service calls being named upfront is the right call *if* you go distributed. | Keep as-is |
| S11 | **Backend-for-Frontend pattern with three distinct clients** | §2.4 | Correctly prevents the "UI fans out to 9 services" antipattern, and correctly recognises that customer / vendor / admin have genuinely different aggregation needs. | Keep as-is |
| S12 | **Accessibility named with a concrete standard** (WCAG AA contrast, keyboard nav, screen reader) | §4.5 | Named standard rather than "should be accessible". | Keep + extend to vendor/admin dashboards, which §4.5 currently omits |
| S13 | **Self-aware conclusion** — flags the need for a Data & Analytics doc and an Ops Playbook | §Conclusion | Correctly identifies two of its own biggest holes. | Keep — but **promote both from "later" to V1** (see G12, G21) |

### Updates required on the strengths above

| Ref | Required change | Reason |
|---|---|---|
| S2 | Add a **variable-weight / loose-goods** specification | "kg/g" is modelled but loose vegetables and meat need a whole flow (see G6). Currently a single clause in §2.2. |
| S4 | Add **COD cash reconciliation** (rider → cash custody → vendor commission recovery) | The doc covers COD *confirmation* but not COD *money movement*, which is the harder half. |
| S6 | Add OTP rate limiting / SMS-pumping defence, API rate limits, idempotency keys | Auth design is sound but the abuse surface is unaddressed (see G18). |
| S8 | Re-label §2.2 as **bounded contexts / deployable modules**, with an explicit extraction trigger per module | Prevents day-1 over-engineering while preserving the (correct) domain boundaries. |
| S9 | Remove MongoDB; use PostgreSQL JSONB + a real search engine | Two primary datastores for one catalog is unjustified complexity (see G3). |
| S13 | Move analytics event schema and the ops playbook into V1 scope | You cannot retrofit a funnel; untracked launch weeks are permanently lost data. |

---

## Part B — Gap List

Severity: **P0** = blocks a correct build or creates legal/financial exposure · **P1** = will force a painful rewrite or hurt the business materially · **P2** = should be closed before scale-up.

---

### 🔴 P0 GAPS

#### G1 — Architecture is over-specified for the stated scale (biggest strategic risk)
**Gap:** The doc mandates 14 microservices + Kafka + Kubernetes + Postgres + MongoDB + Redis + a search index + BFF, on day one. The justification given is citations to blog posts, not load arithmetic.
**Why it matters:** 14 services means 14 deploy pipelines, 14 sets of migrations, distributed transactions across cart→inventory→payment→order, and cross-service debugging — before you have a single paying customer. This is the most common way pre-PMF marketplaces die: they spend 9 months on infrastructure and ship nothing.
**How to deal:**
1. Rewrite §2.1 to specify a **modular monolith** — one deployable, one Postgres, hard-enforced module boundaries matching the 14 domains already identified (no cross-module DB reads; modules talk via in-process interfaces).
2. Extract to a service **only on a documented trigger**. Publish the trigger table in §2.2:

| Module | Extract when |
|---|---|
| `search` | Catalog > 200K offers, or search p95 > 200ms |
| `payment` + `cod-oms` | Needs independent PCI/compliance scope, or separate on-call |
| `notification` | Outbound volume causes request-path latency |
| `analytics` | Reporting queries contend with transactional load |
| Everything else | Only when a team owns it full-time |

3. Keep Kubernetes optional — a managed container platform (ECS/Fargate, Cloud Run, App Runner) is sufficient to well past 100K orders/day and costs a fraction of the ops overhead.
4. Keep the event bus, but start with **Postgres-backed outbox + a simple queue (SQS/Redis Streams)**. Introduce Kafka only when you have a real streaming consumer.

---

#### G2 — Delivery and logistics do not exist in the document
**Gap:** The word "delivery" appears throughout (slots, ETA, delivery fee, tracking, map) but there is **no delivery domain**: no `delivery-service`, no rider/driver role in the RBAC list, no rider app in the frontend spec, no dispatch or assignment logic, no 3PL integration, no delivery-fee engine, no proof-of-delivery, no failed-delivery/RTO flow, no rider earnings or payouts.
**Why it matters:** In grocery, ~60–70% of operating cost and ~90% of customer complaints are logistics. §4.2 promises the customer a live map and ETA that nothing in the architecture can produce.
**How to deal:**
1. Add **§2.2.x `delivery-service`** owning: delivery-partner registry, shift/availability, order→rider assignment, batching, live location ingestion, ETA computation, proof of delivery (OTP or photo), COD cash collection record, failed-delivery and RTO states.
2. Add **§2.2.x `serviceability-service`** owning: pincode/polygon geofences, store service radius, slot capacity, cutoff times, blackout windows.
3. Decide and document the fulfilment model explicitly:
   - **(a) Vendor self-delivery** — cheapest to launch, lowest control, no rider app needed in V1.
   - **(b) 3PL aggregator** (Shadowfax / Porter / Borzo / Dunzo-style) — adapter interface, per-order cost, no fleet ops.
   - **(c) Own fleet** — highest cost and control, requires rider app + payouts + attendance.
   - **Recommendation for V1: (a) with (b) as a pluggable fallback**, behind one `FulfilmentProvider` interface so (c) can be added without touching order code.
4. Add roles **Rider** and **Fleet manager** to §3.2, with location-data privacy rules (rider location is PII; retain only for active orders + a short audit window).
5. Add a **Rider app spec** to §4 (accept, pick up, navigate, OTP-confirm delivery, collect COD, end-of-day cash handover) — or explicitly state V1 has no rider app because of choice (a).
6. Add tickets: EPIC-010 Delivery & Fulfilment (assignment, tracking, POD, RTO, 3PL adapter, delivery fee engine).

---

#### G3 — No master-catalog vs vendor-offer data model
**Gap:** §1.4 says vendors "create/edit SKUs" and §2.2 says `catalog-service` holds "SKUs". If each vendor creates their own SKU, a search for "Aashirvaad Atta 5kg" returns 40 near-duplicate rows and price comparison becomes impossible.
**Why it matters:** This is the load-bearing data decision of a multi-vendor marketplace. Getting it wrong means a full catalog migration later, plus permanently broken search relevance and analytics.
**How to deal:**
1. Specify a two-tier model in §2.3:
   - **`master_product`** — canonical, admin-governed: global product ID, brand, name, net quantity + UoM, EAN/barcode, category, attributes, images, HSN code, GST rate, veg/non-veg mark, FSSAI-relevant flags.
   - **`vendor_offer`** — per vendor per master product: MRP, selling price, stock on hand, reserved qty, status, batch/expiry, per-slot availability.
2. Search indexes **master products**, with offers joined at render time (cheapest / nearest / in-stock).
3. Add a **catalog matching & moderation pipeline**: vendor scans barcode or picks from master → if no match, submit-for-approval queue → admin approves and merges. Add tickets for both the queue and the dedupe/matching job.
4. Drop MongoDB. Postgres `JSONB` handles flexible attributes; a dedicated search engine handles search. Two primary stores buys you dual-write bugs, not flexibility.

---

#### G4 — Multi-vendor cart semantics are never decided
**Gap:** The doc never states whether one cart can contain items from multiple stores. Every downstream design depends on the answer: order model (one order vs parent + child orders), delivery fee (per store?), payment splitting, partial cancellation, multiple ETAs, refund granularity, payout attribution, invoicing (GST invoices are **per supplier**, not per marketplace).
**How to deal:**
1. Make the decision explicit in §1.1 and §2.2.
2. **Recommendation: single-vendor cart for V1.** Grocery baskets are fulfilled by one store; multi-store means multiple delivery fees and multiple ETAs, which customers reject. It also removes the hardest 30% of the payment/refund/payout work.
3. If multi-vendor is required, specify the **parent order → sub-order per vendor** model up front, with: sub-order-level status, sub-order-level payment allocation, sub-order-level refunds, one GST invoice per vendor, and a UX that shows separate ETAs.

---

#### G5 — Inventory reservation / oversell prevention has no design
**Gap:** §2.2 says `inventory-service` handles "reservations" — one word. There is no concurrency model, no reservation lifetime, no reserve→pay→confirm→release saga, no oversell policy.
**Why it matters:** Grocery stock is often 1–5 units per SKU. Two customers hitting checkout simultaneously will oversell without an explicit design, and §1.2's "<2% out-of-stock at fulfilment" metric is unachievable without one.
**How to deal:** Specify in §2.3:
- Reserve at **checkout initiation**, not at add-to-cart (cart holds cause phantom OOS).
- Concurrency: `SELECT … FOR UPDATE` on the offer row, or an optimistic `version` column with retry. State which.
- Reservation TTL (e.g. 10 min) with a sweeper job releasing expired holds.
- Compensating release on payment failure, timeout, or vendor rejection.
- Explicit oversell policy: what the customer sees when stock vanishes between reservation and picking (→ links to G7 substitutions).
- **Idempotency keys** on reserve/confirm/release so retries can't double-decrement.

---

#### G6 — Variable-weight goods are one clause, not a specification
**Gap:** §2.2 mentions "capture during weight-based adjustments" and nothing else. Loose vegetables, fruit, meat and dairy — the core of a kirana basket — are ordered by intent ("1 kg tomatoes") and delivered by actual weight (0.94 kg).
**How to deal:** Add **§1.4.x Variable-weight items**, covering:
- Product flag `is_variable_weight`, with a **tolerance band** (e.g. ±10%) surfaced to the customer at add-to-cart ("final price may vary by weight").
- Online payments: **pre-authorise** the upper bound, **capture** the actual on packing. Confirm your gateway supports auth/capture with a downward-adjusted capture, and that auth hold windows exceed your slot lead time — this constrains gateway choice, so decide early.
- Where partial capture isn't supported: charge the estimate and **auto-refund the delta**, with a refund threshold below which you absorb the difference.
- COD: recalculate and **round** the collectable amount; rider collects the final figure.
- Invoice must be regenerated post-weighing; the *invoiced* amount is the actual, not the estimate.
- Picker UI: enter actual weight per line item.

---

#### G7 — Substitutions deferred, but they are unavoidable on day one
**Gap:** Substitutions are marked "later phases" in four places (§1.4 cart, §1.4 PDP, §2.2 cart-service, §4.2).
**Why it matters:** 5–15% of grocery lines go out of stock between order and picking. With no substitution flow, every one of those becomes a cancellation, a refund, and a churned customer.
**How to deal:** Promote to V1:
- Customer preference per order (and a saved default): *Auto-substitute similar* / *Call/message me* / *Refund that item*.
- Picker flow: mark OOS → system suggests substitutes from the same master category with a price-delta rule (never charge more than the original without consent).
- Notify customer with accept/reject window; auto-apply their stored preference on timeout.
- Price reconciliation and partial refund path (shares plumbing with G6).

---

#### G8 — Indian tax and marketplace-compliance obligations are absent
**Gap:** §3.6 says "adhere to local data protection and financial transaction norms". That is a placeholder, not a requirement. There is no tax engine, no GST handling, no invoicing model.
**Why it matters:** These are statutory. Non-compliance is a licensing and penalty issue, not a backlog item — and tax logic is deeply entangled with pricing, invoicing, and payouts, so retrofitting it is expensive.
**How to deal:** Add **§3.7 Tax, Invoicing & Marketplace Compliance** covering:
- **GST**: HSN code and GST rate on every master product (grocery slabs genuinely differ — unbranded staples vs branded packaged vs processed foods). Tax-inclusive vs exclusive pricing decision. **One GST invoice per vendor per order**, issued in the vendor's GSTIN, not the marketplace's.
- **TCS under GST §52** and **TDS under Income Tax §194-O** — both apply to e-commerce operators collecting payment on behalf of sellers. Rates have changed recently; confirm current rates with your CA and make them **configurable**, not hardcoded. Both require monthly filings and a per-vendor deduction ledger.
- **Legal Metrology (Packaged Commodities) Rules** — for pre-packaged goods, the listing must display net quantity, MRP, manufacturer/packer, consumer-care contact, and country of origin. This is a **catalog schema requirement**, so it belongs in G3's `master_product`.
- **FSSAI** — vendor licence number captured at KYC, validated, expiry-tracked, and displayed. Add to the §1.4 vendor onboarding field list alongside GST and bank details.
- **Perishables**: batch/lot and expiry date on `vendor_offer`, FEFO picking, and a **recall workflow** (identify affected batch → find orders → notify customers). Currently entirely absent.
- **Consumer Protection (E-Commerce) Rules** — named grievance officer, published contact, acknowledgement and resolution SLAs. Needs an admin-side complaints module.

---

#### G9 — DPDP Act 2023 obligations not addressed
**Gap:** §3.3 covers encryption and minimisation (good) but never names India's **Digital Personal Data Protection Act, 2023**, and none of its operational requirements appear.
**How to deal:** Add to §3.3/§3.6:
- Itemised **consent notice** at signup, in English + regional languages, with purpose-specific consent and withdrawal as easy as granting.
- **Data principal rights**: access, correction, erasure, grievance redressal — each needs an actual API and a UI surface, not a policy paragraph. Add tickets.
- **Retention schedule** per data class (orders retained for tax/audit; marketing consent expires; rider location purged after delivery + audit window).
- Named **Data Protection Officer / grievance officer** and a published channel.
- **Breach notification** runbook with the statutory reporting path.
- Third-party processor agreements (PG, SMS, WhatsApp, 3PL, analytics) — each processes personal data on your behalf.
- Confirm current rule status and timelines with counsel; requirements have been phasing in.

---

#### G10 — Scale numbers contradict themselves and the performance target is wrong
**Gap:**
- Executive Summary: "beyond 100K+ users and **thousands of daily orders**"
- §1.2: "100K+ registered users … and **100K daily orders**"
- §2.5: "Concurrent users 10,000+; Daily orders 100,000+"

100K daily orders from 100K registered users means every registered user orders every single day. That is not a real number, and it is being used to justify the architecture in G1.
Separately, §1.5 targets "**TTFT < 5 seconds** under load". TTFT is a language-model metric (time to first token) and doesn't apply here; and 5 seconds is an unacceptably weak target either way.
**How to deal:**
1. Rebuild the capacity model bottom-up and state it once, in §1.5, with §2.5 referencing it:
   - Registered users → monthly active % → orders per active user per month → **daily orders**
   - Daily orders → peak-hour concentration (grocery peaks hard at 7–10am and 6–9pm; assume ~20% of daily volume in the peak hour) → **peak orders/sec**
   - Read:write ratio (browse ≫ order, typically 100:1+) → **peak API RPS**
   - A realistic V1 target: 100K registered users, ~15% monthly active, ~4 orders/user/month → **~2K orders/day**, peaking ~400/hr. That is comfortably a single well-built application — which is the evidence for G1.
2. Replace the performance NFR with real SLOs:

| Surface | Target |
|---|---|
| Search / listing API | p95 < 200 ms, p99 < 500 ms |
| Add-to-cart, checkout APIs | p95 < 300 ms |
| Payment initiation | p95 < 800 ms |
| Home LCP (mid-range Android, 4G) | < 2.5 s |
| Error budget | 99.9% monthly for core flows |

3. State the target as **"day-1 capacity: X; architecture must reach Y without rewrite"** — that's the real requirement, and it's a much weaker constraint than "build for Y now".

---

### 🟠 P1 GAPS

#### G11 — No supply-side reality plan (the #1 reason this category fails)
**Gap:** The doc assumes kirana vendors will maintain SKU-level catalogs, update stock in real time, and work from a web dashboard. Most independent kirana stores have no digital catalog, no SKU-level stock discipline, and run on paper and WhatsApp. §1.4's vendor requirements describe a small supermarket chain, not a kirana.
**How to deal:**
- Add **§1.6 Vendor Onboarding & Adoption Model** to the PRD.
- **Assisted onboarding**: field team or self-serve wizard that seeds a store's catalog from the master catalog (pick your top 300 SKUs), rather than asking for data entry.
- **Degrade gracefully on stock**: don't require live counts. Offer three tiers — (1) simple In-stock / Out-of-stock toggle, (2) low-stock threshold, (3) true quantity tracking for vendors who can. Model this as a per-vendor `inventory_mode` in `vendor_offer`.
- **WhatsApp-first order intake** for vendors, with the dashboard as an upgrade — kirana owners will not sit at a dashboard, but they will answer WhatsApp. This directly affects `notification-service` and vendor SLA design.
- Define **vendor SLAs and consequences**: acceptance timeout, auto-cancel, auto-reassign to next-best store, suspension thresholds. None of this exists today.
- Add vendor-side success metrics to §1.2 (time-to-first-order, catalog completeness %, acceptance rate, OOS rate, active-vendor retention). Current metrics are entirely demand-side.

#### G12 — No unit economics or commission model
**Gap:** §1.4 admin scope says "configuration of take rate", and §4.4 puts GMV and take rate on the dashboard — but the PRD never defines the commission model, and there are **no money metrics** in §1.2. Grocery runs at 3–8% gross margin; unit economics *are* the product.
**How to deal:**
- Add **§1.2.x Business Model & Unit Economics**: commission structure (flat % / category-wise / tiered by volume), delivery fee logic and who bears it, minimum order value, packaging fee, surge/small-cart fee, vendor subscription tier if any.
- Add to the metrics list: **AOV, contribution margin per order, delivery cost per order, CAC, blended take rate, monthly GMV, RTO % (COD), refund % of GMV**.
- Add an infra **cost model** to §2.5 — cost per 1,000 orders. This is also the strongest argument for or against G1's architecture.

#### G13 — Order state machine is inconsistent and incomplete
**Gap:** Customer states (§1.4): Confirmed, Packed, Out for Delivery, Delivered, Cancelled. Vendor states (§1.4): New, Accepted, Packed, Handover, Completed, Cancelled. These don't map, and neither includes rider states, payment states, or any of: `Payment Pending`, `Awaiting Vendor Acceptance`, `Substitution Pending`, `Partially Fulfilled`, `Delivery Failed`, `Returned`, `Refunded`, `RTO`.
**How to deal:**
- Define **one canonical state machine** in §2.2 under `order-service`, with an explicit transition table (from → to → who may trigger → side effects → events emitted).
- Render **role-specific labels** over the canonical states rather than maintaining two vocabularies.
- Model **payment status as an orthogonal axis** (Pending / Authorised / Captured / Failed / Refunded / Partially Refunded) — conflating it with fulfilment status is a classic and painful mistake.
- Add a line-item-level status to support partial fulfilment (G7) and partial refunds.

#### G14 — Money movement is under-designed: settlements, ledger, COD cash
**Gap:** `payout-service` is one line: "vendor settlements and commission logic". There is no settlement cycle, no reconciliation against the gateway settlement file, no ledger design, and — critically — **no COD cash reconciliation**.
**Why it matters:** In COD, the rider holds the customer's cash, the vendor is owed the goods value, and the marketplace is owed commission on money it never touched. Reconciling this daily across hundreds of riders and vendors, with cash shortfalls and disputes, is the hardest operational problem in Indian e-commerce, and it is currently a blank page.
**How to deal:**
- Add **§2.x Financial Ledger** — a double-entry ledger as the source of truth: every order, refund, commission, TCS/TDS deduction, delivery fee, penalty, and cash-in-hand event is a journal entry. Do not compute payouts by summing order rows.
- Define the **settlement cycle** (e.g. T+3 for prepaid, T+7 for COD after cash reconciliation), holdback %, and dispute reserve.
- **Prepaid reconciliation**: import the PG settlement file daily, match to orders, and raise exceptions on mismatch.
- **COD cash flow**: rider collects → end-of-day cash-in-hand record → deposit against reference → matched to bank credit → vendor payout net of commission/TCS. Add shortfall tracking per rider and an escalation path.
- Vendor-facing statement UI: opening balance, orders, deductions, adjustments, payout, closing balance.

#### G15 — Cancellations, refunds, returns and disputes have no flow
**Gap:** "refunds" appears in the §2.1 Financial domain and "disputes" in the Operations domain; neither has a specification anywhere.
**How to deal:** Add **§1.4.x Cancellations, Refunds & Returns**:
- Cancellation windows and who may cancel at each order state; cancellation fee policy.
- Refund routing: original payment method vs **store credit/wallet** (wallet is faster, cheaper, and improves retention — but has RBI implications if it holds real value; decide deliberately).
- Refund SLAs by method, and customer-visible refund status tracking.
- **Perishable returns policy** — you generally cannot restock returned fresh produce. Define a "refund without return" threshold and an abuse-detection rule.
- Partial refunds for missing/substituted/underweight items (shared plumbing with G6, G7).
- Dispute lifecycle with evidence capture, and **chargeback handling** for card payments (representment deadlines, liability allocation to vendor or platform).

#### G16 — Search is a single phrase, not a design
**Gap:** §2.2 lists "search index" inside `catalog-service`. §1.4 mentions filters and auto-suggest. That's the whole treatment.
**Why it matters:** Search drives the majority of grocery sessions, and Indian grocery search is unusually hard: transliteration (`atta` / `aata` / `आटा`), regional names (`kanda` = onion, `bhindi` = okra, `jeera` = cumin), heavy misspelling, and brand-vs-category ambiguity.
**How to deal:** Add **§2.x Search Design**:
- Pick an engine — **OpenSearch/Elasticsearch** if you need deep customisation, **Typesense/Meilisearch** if you want typo-tolerance and speed with far less ops. For V1, Typesense is the pragmatic choice; Postgres full-text is not sufficient here.
- **Transliteration + synonym dictionary** maintained as data, seeded per region, editable by ops without a deploy.
- **Availability as a ranking signal** — never rank an out-of-stock offer above an in-stock one; ideally filter by the user's serviceable stores before ranking.
- Zero-result handling: spell correction → category fallback → "notify me when available".
- Index freshness requirement (stock changes must reflect in seconds, not minutes) and the reindex/backfill strategy.
- Track search KPIs: zero-result rate, search→add-to-cart conversion, top failed queries (this feeds the synonym dictionary).

#### G17 — Slot capacity has no model
**Gap:** Slots appear in checkout UI and `inventory-service` ("availability per slot") but there is no capacity system.
**How to deal:** Add to the `serviceability-service` from G2: slot definitions per store, **capacity = min(picking capacity, rider capacity)**, real-time decrementing as orders are booked, cutoff times, same-day vs next-day rules, blackout/holiday windows, and a slot-full UX. Also define behaviour when a vendor over-commits (auto-close remaining slots).

#### G18 — Abuse and API-hardening surface is unaddressed
**Gap:** §3 covers auth, RBAC, and payment fraud well, but omits the abuse vectors that actually cost money early.
**How to deal:** Add **§3.x Abuse Prevention & API Hardening**:
- **OTP abuse / SMS pumping** — per-phone and per-IP rate limits, exponential backoff, cooldowns, CAPTCHA escalation, device fingerprinting. This is a direct, fast cash drain if left open.
- **Idempotency keys** mandatory on order creation, payment initiation, refund, and inventory mutation endpoints.
- **Webhook security beyond signatures**: replay protection (timestamp + nonce), out-of-order delivery handling, and an at-least-once processing model.
- **Global rate limiting + WAF + bot protection** at the gateway; scraper defence on the catalog (competitors will scrape your prices).
- **Non-payment fraud**: vendor self-ordering to farm ratings, fake stock listings, refund abuse, promo/referral abuse, rider collusion. Define detection rules and an ops review queue.
- **Secrets management** and key rotation — currently unmentioned.
- Coupon/promo engine security: single-use enforcement, per-user caps, stacking rules, race-condition protection.

---

### 🟡 P2 GAPS

#### G19 — No localisation, low-end device, or connectivity strategy
Add to §4.1: language support (English + Hindi + launch-region language) with a translation pipeline covering **product names**, not just UI chrome; PWA vs native decision with rationale; app size and cold-start budget; behaviour on 3G and on intermittent connectivity (offline cart, optimistic UI, retry queue); number/currency/date formatting.

#### G20 — Notification channel realities missing
`notification-service` lists push/email/SMS/in-app but omits **WhatsApp Business API**, which is the dominant transactional channel in India and is already assumed by the COD flow in §3.4. Add: WhatsApp BSP selection, template pre-approval workflow and lead time, **TRAI DLT registration** for SMS (sender ID + template registration is mandatory), DND/opt-out handling, per-channel fallback chain, and quiet hours.

#### G21 — Analytics deferred; it should be day-1
The conclusion defers the Data & Analytics doc. Untracked launch weeks are unrecoverable. Move into V1: a **canonical event schema** (view_item, add_to_cart, begin_checkout, purchase, substitution_accepted, order_cancelled, slot_selected, search_performed …), funnel definitions matching §1.2's metrics, and the pipeline (events → warehouse → dashboards). Attach an event to each relevant frontend ticket.

#### G22 — No environment, testing, or release strategy
Add **§2.7 Environments & Quality**: environment matrix (local/dev/staging/prod), payment **sandbox** strategy, test data and seeded catalog, test pyramid targets, contract tests between modules, load-test scenarios tied to the G10 capacity model, E2E coverage for checkout/COD/refund, feature flags, and rollback procedure. EPIC-009 has one load-test ticket; that's the whole current treatment.

#### G23 — No phased rollout plan
Add **§1.7 Rollout Plan**: pilot scope (1 pincode, 10–20 vendors, N weeks), explicit **go/no-go criteria** to expand (order volume, OOS rate, on-time delivery %, vendor retention, contribution margin), then city, then multi-city. Name what gets cut if the pilot underperforms.

#### G24 — Feature ticket list is a sketch, not a backlog
27 tickets for a platform of this scope, with no estimates, no priorities, no dependency graph, no MVP cut-line, and — despite §5.2 saying each ticket "should include a short description, acceptance criteria, and dependencies" — **not one ticket actually shows them**.
**How to deal:** Write 2–3 fully-worked exemplar tickets (description, acceptance criteria in Given/When/Then, dependencies, test notes, analytics events, estimate) so the team has a template. Add EPIC-010 Delivery, EPIC-011 Tax & Compliance, EPIC-012 Refunds & Disputes, EPIC-013 Search, EPIC-014 Analytics. Mark each ticket **MVP / Fast-follow / Later** and draw the cut-line.

#### G25 — Competitive positioning and the wedge are missing
The PRD never says why a customer chooses FreshKirana over Blinkit/Zepto/Instamart (10-minute dark-store delivery) or over calling their existing kirana on WhatsApp. Slot-based multi-vendor is a *different* game from quick commerce, and the doc should say which game it's playing and why it wins. Add **§1.0 Problem, Positioning & Differentiation** — 5 paragraphs, before §1.1.

#### G26 — Reference quality is uneven
Several citations are Dribbble tag/search pages ([16], [23], [24], [25]), a template-marketplace product listing ([19]), LinkedIn posts ([13], [20]), and vendor marketing blogs ([1], [3], [10]). Dribbble is mood-board material, not a source for "best practice" claims — and §4.3/§4.4's dashboard UX rests almost entirely on it.
**How to deal:** Keep the genuinely strong sources (Baymard [8]/[9], the ReCANet paper [11], Ipsos [14]/[15]). Replace the rest with primary sources: NPCI/RBI circulars for UPI and tokenization, the CBIC/GST portal for TCS and invoicing, the DPDP Act text and rules, FSSAI and Legal Metrology notifications, Nielsen Norman Group for dashboard UX. Mark any remaining Dribbble links explicitly as *visual inspiration*, not evidence.

---

## Part C — My Recommendations

### 1. The single most important change: right-size the architecture
Everything in G1 and G10 points the same way. The stated V1 scale — realistically ~2K orders/day — is comfortably served by **one well-structured application on one Postgres**, with Redis and a search engine alongside. The 14-domain decomposition in §2.2 is *good thinking* and should be preserved exactly as it is — as **module boundaries inside one deployable**, with the published extraction triggers from G1. You keep every architectural benefit the doc is reaching for, and you ship in a quarter instead of a year.

### 2. The second most important change: the missing half of the business
The document covers **discover → cart → pay** in real depth and **fulfil → deliver → refund → settle → comply** almost not at all. G2 (delivery), G8 (tax/compliance), G14 (ledger and COD cash), G15 (refunds) are all in that second half, and all are P0/P1. A grocery marketplace is judged on the second half. I'd budget more documentation and engineering effort there than on the first half.

### 3. Cut V1 scope hard, and be explicit about it
The PRD's V1 is far too broad. My proposed cut-line:

| Keep in V1 | Cut to fast-follow | Cut to later |
|---|---|---|
| OTP login, addresses | Social login, guest checkout | Multi-language beyond 2 |
| Master catalog + vendor offers | Vendor bulk upload | Vendor POS integration |
| Search (basic + synonyms) | Voice search | Personalised ranking |
| Single-vendor cart, slot checkout | Multi-vendor cart | Subscriptions / repeat orders |
| **Substitutions** (G7) | | |
| **Variable weight** (G6) | | |
| UPI + COD | Cards, wallets | EMI, BNPL |
| COD confirmation + risk rules | Advanced fraud ML | |
| Order lifecycle + tracking | Live map tracking | Rider ETA prediction |
| Reorder / Buy Again | Recommendations | Predictive basket (ReCANet-style) |
| Vendor dashboard + **WhatsApp order intake** | Vendor analytics | Vendor ads/promotions |
| Admin: vendors, orders, COD queue | Admin: full BI | Automated vendor scoring |
| **GST invoicing + TCS/TDS ledger** | | |
| **Refunds + partial refunds** | Returns workflow | |
| Ratings (order-level) | Product reviews | Photo reviews |

Note that substitutions, variable weight, and GST invoicing — all currently absent or deferred in the source doc — are in the **keep** column, while several things currently in V1 (social login, voice search, reviews, multi-vendor cart) move out. That trade is the core of my recommendation.

### 4. Sequence the documentation work
1. **Fix §1.2/§1.5/§2.5 numbers first** (G10) — everything downstream is sized off them, and the current numbers are actively misleading the architecture.
2. **Decide the three load-bearing questions** (G3 catalog model, G4 cart scope, G2 fulfilment model) — these three answers determine most of the remaining design.
3. **Write the two missing documents now, not later**: *Ops Playbook* (G14 COD cash, incident response, vendor SLA enforcement, support workflows) and *Data & Analytics* (G21). The conclusion already identifies both — it just puts them in the wrong phase.
4. **Add a Compliance & Tax annexe** (G8, G9) and get it reviewed by a CA and a lawyer. This is the one section you should not write from first principles.
5. **Rewrite EPIC list and tickets last**, once 1–4 are settled.

### 5. Two things I'd add that aren't gaps in the doc — they're opportunities
- **The WhatsApp-native vendor experience is your actual moat.** G11 treats it as a workaround, but a kirana that can run its entire FreshKirana presence from WhatsApp — receive orders, mark items OOS, confirm handover — is a product no dashboard-first competitor will match. I'd elevate this from a mitigation to a **headline differentiator** in §1.0 (G25).
- **Repeat-basket intelligence is under-exploited.** The doc cites the ReCANet paper [11] but only uses it to justify a "Buy Again" carousel. Grocery is the one vertical where purchase history genuinely predicts the next basket. A "your usual monthly basket, ready to order" flow — predicted quantities, predicted timing, one tap — is achievable with simple frequency heuristics long before any ML, and it attacks retention (§1.2's ≥40% repeat rate) more directly than anything else in the backlog.

### 6. What I'd worry about most, honestly
The riskiest assumption in this document isn't technical — it's **§1.1's premise that kirana stores will maintain accurate SKU-level inventory**. Every downstream promise (the <2% OOS metric, real-time stock, slot commitments, substitution avoidance) rests on it, and it is the assumption most likely to be false in practice. G11 proposes mitigations, but I'd go further: **validate this with 10 real stores before writing any more code.** If kiranas won't or can't keep stock accurate, the product needs to be designed around uncertain inventory from the start — confirm-then-charge, generous substitution defaults, conservative slot promises — which is a materially different product than the one specified here.

---

## Summary Scorecard

| Area | Coverage | Notes |
|---|---|---|
| Product vision & scope | 🟡 Partial | Solid feature list; missing positioning, business model, rollout plan |
| Customer experience (browse→pay) | 🟢 Strong | Genuinely good, research-backed grocery UX |
| Fulfilment & delivery | 🔴 Absent | No delivery domain at all — largest single gap |
| Catalog & inventory | 🟡 Partial | Right instincts, no data model, no reservation design |
| Payments | 🟢 Strong | UPI + COD depth is the doc's standout section |
| Money movement (settlement/ledger/COD cash) | 🔴 Weak | One line for the hardest operational problem |
| Refunds, returns, disputes | 🔴 Absent | Named, never specified |
| Architecture | 🟡 Over-built | Good boundaries, premature distribution, contradictory sizing |
| Security | 🟢 Strong | Excellent fundamentals; abuse surface missing |
| Compliance (tax, DPDP, FSSAI, metrology) | 🔴 Absent | Placeholder text where statutory requirements belong |
| Frontend spec | 🟡 Partial | Good customer spec; vendor/admin lean on weak sources; no i18n |
| Search | 🔴 Weak | One phrase for a make-or-break surface |
| Analytics | 🔴 Deferred | Should be V1 |
| Backlog quality | 🟡 Sketch | Right structure, ~15% of needed depth |
