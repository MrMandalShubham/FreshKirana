# FreshKirana – Scalable Grocery Marketplace Documentation Set

**Version:** 2.2 · **Date:** 2026-08-12 · **Status:** Ready for engineering review
**v2.1:** OD-1 closed — **TypeScript/NestJS** confirmed for the core.
**v2.2:** **No AI in the MVP.** No Python service, no ML infrastructure, no LLM provider at launch. Every V1 capability ships as SQL, rules or off-the-shelf search. The seam is kept open at a cost of roughly half a day (§2.17).
**Supersedes:** v1.0 (archived at `archive/FreshKirana – Documentation Set v1.0 (original).md`)
**Companion:** `FreshKirana – Documentation Review, Gap Analysis & Recommendations.md`

---

## Document Control — What Changed in v2.0

| # | Change | Closes |
|---|---|---|
| 1 | Capacity model rebuilt bottom-up; contradictory scale figures removed; TTFT replaced with real SLOs | G10 |
| 2 | Architecture re-specified as a **modular monolith** with published service-extraction triggers | G1 |
| 3 | **Delivery & fulfilment** added as a full domain (§2.9), plus rider roles and rider app spec | G2 |
| 4 | **Master product / vendor offer** two-tier catalog model specified; MongoDB dropped | G3 |
| 5 | **Single-vendor cart** decided for V1, with the multi-vendor path documented for later | G4 |
| 6 | Inventory **reservation & concurrency** design added (§2.5) | G5 |
| 7 | **Variable-weight goods** fully specified (§1.7.1) | G6 |
| 8 | **Substitutions** promoted from "later" into V1 (§1.7.2) | G7 |
| 9 | **Tax, invoicing & marketplace compliance** section added (§3.7) | G8 |
| 10 | **DPDP Act 2023** obligations specified as buildable requirements (§3.6) | G9 |
| 11 | **Vendor adoption model** added — WhatsApp-first, tiered inventory modes (§1.9) | G11 |
| 12 | **Business model & unit economics** added, with money metrics (§1.3) | G12 |
| 13 | **Canonical order state machine** replaces two conflicting vocabularies (§2.6) | G13 |
| 14 | **Double-entry ledger, settlements, COD cash reconciliation** added (§2.11) | G14 |
| 15 | **Cancellations, refunds, returns, disputes** specified (§1.10) | G15 |
| 16 | **Search design** added, incl. transliteration and regional synonyms (§2.7) | G16 |
| 17 | **Serviceability & slot capacity** model added (§2.8) | G17 |
| 18 | **Abuse prevention & API hardening** added (§3.3) | G18 |
| 19 | **Localisation, device and connectivity** budgets added (§4.1) | G19 |
| 20 | **WhatsApp Business API + TRAI DLT** added to notifications (§2.12) | G20 |
| 21 | **Data & Analytics** promoted from "later document" into §5 | G21 |
| 22 | **Environments, testing & release** added (§2.15) | G22 |
| 23 | **Phased rollout plan** with go/no-go gates added (§1.11) | G23 |
| 24 | Backlog expanded to 14 epics with worked exemplar tickets and an explicit MVP cut-line (§7) | G24 |
| 25 | **Problem, positioning & differentiation** added as §0 | G25 |
| 26 | References cleaned; inspiration separated from evidence | G26 |
| 27 | **Ops Playbook** promoted from "later document" into §6 | S13 |

---

## Executive Summary

FreshKirana is a multi-vendor grocery marketplace that brings local kirana stores online with a **planned-basket, slot-based** model — deliberately not competing with 10-minute quick commerce, but serving the weekly and monthly household shop that quick commerce serves badly.

The platform is designed so that a kirana owner can run their entire FreshKirana presence **from WhatsApp**, without ever opening a dashboard. That, plus **repeat-basket intelligence** built on purchase history, is the wedge.

Technically, FreshKirana launches as a **modular monolith** — one deployable, one PostgreSQL, with hard-enforced module boundaries matching fourteen bounded contexts. Services are extracted only on published, measurable triggers. This is a deliberate reversal of v1.0's day-one microservices plan: the realistic Year-1 load (~2,000 orders/day, ~150 peak RPS) does not justify distributed-systems overhead, and shipping speed is the binding constraint before product-market fit.

This document set contains eight parts: Positioning (§0), PRD (§1), Technical Architecture (§2), Security & Compliance (§3), Frontend Specification (§4), Data & Analytics (§5), Ops Playbook (§6), and the Feature Backlog (§7), followed by open decisions (§8).

---

# 0. Problem, Positioning & Differentiation

## 0.1 The problem

Indian households buy groceries in two distinct modes:

| Mode | Basket | Frequency | Served by |
|---|---|---|---|
| **Top-up** — ran out of milk | 1–4 items, ₹80–250 | Several times/week | Quick commerce (Blinkit, Zepto, Instamart) — well served |
| **Planned shop** — the monthly/weekly stock-up | 20–60 items, ₹800–3,000 | 1–4 times/month | **Poorly served** |

The planned shop is currently done by walking to the kirana, or by sending a WhatsApp list to a shop that then calls back about missing items, negotiates substitutions verbally, and hand-writes the bill. It works, but it is slow, error-prone, has no price transparency, no order history, and no reorder.

Quick commerce serves this mode badly on purpose: dark stores carry 2,000–6,000 SKUs optimised for impulse, not the long tail of staples, regional brands, and loose produce a planned basket needs.

## 0.2 Positioning

> **FreshKirana is the planned grocery shop, done properly — your neighbourhood kirana's full range, ordered in two minutes from your last basket, delivered in a slot you chose.**

We compete on **basket completion, price, and range** — not on speed. A 2-hour or next-morning slot is a feature, not a compromise: it lets us serve a real store's full catalog, including loose produce and regional brands no dark store stocks.

## 0.3 Differentiation — three defensible wedges

**1. WhatsApp-native vendor operations.** Kirana owners will not learn a dashboard. They already live in WhatsApp. A vendor can accept orders, mark items out of stock, propose substitutions, and confirm handover entirely through WhatsApp templates and quick-reply buttons. The web dashboard is an *upgrade path* for larger stores, not the primary interface. Dashboard-first competitors structurally cannot match this without rebuilding their vendor product.

**2. Repeat-basket intelligence.** Grocery is the one vertical where purchase history genuinely predicts the next basket — 70–80% of a household's items repeat. "Your usual monthly basket, ready to order" with predicted items, quantities, and timing is a one-tap re-order of a 40-item list. Achievable with frequency heuristics well before any ML.

**3. Uncertain-inventory design.** We assume kirana stock data will be imperfect (see §1.9) and design around it: confirm-then-charge, generous substitution defaults, conservative slot promises. Competitors who assume accurate inventory will ship a product that breaks on contact with real kiranas.

## 0.4 Explicit non-goals for V1

- Not 10-minute delivery. Not dark stores. Not our own inventory.
- Not a B2B/wholesale platform.
- Not multi-city at launch (see §1.11).
- Not a payments or lending product.

---

# 1. Product Requirements Document

## 1.1 Product overview

FreshKirana is a B2C multi-vendor marketplace. Local stores onboard, map their range against a **central master catalog**, set prices and availability, and fulfil slot-based orders from nearby customers via delivery or pickup.

Defining characteristics:

- **Multi-vendor, single-vendor cart.** Many independent shops; one unified customer experience; **one order is fulfilled by exactly one store** (see §1.6 Decision D2).
- **Grocery-native.** Unit-based products (kg/g/L/mL/piece), variable-weight loose goods, perishables with batch and expiry, high inventory volatility, and substitution as a normal event rather than a failure.
- **India-native.** UPI-first with COD as a first-class flow, GST invoicing per vendor, WhatsApp as the primary notification and vendor-operations channel, regional-language search.

## 1.2 Users and roles

| Role | Primary needs |
|---|---|
| **Customer** | Fast basket rebuild from history, clear units and prices, honest availability, reliable slot, easy substitution control |
| **Vendor owner** | Zero-friction onboarding, orders where they already are (WhatsApp), fair payouts, clear statements |
| **Vendor staff** | Picking list, mark OOS, record actual weights, handover — scoped strictly to their own store |
| **Rider** *(new in v2)* | Clear pickup/drop, navigation, delivery OTP, COD collection, end-of-day cash handover, earnings visibility |
| **Fleet manager** *(new in v2)* | Rider roster, shift and capacity planning, cash reconciliation, exception handling |
| **Admin / Ops** | Vendor approvals, live order exceptions, COD risk queue, disputes, catalog governance, marketplace health |
| **Finance** *(new in v2)* | Ledger, settlements, TCS/TDS deductions, reconciliation, statutory filings |
| **Support** | Customer and vendor contact, refunds within limits, escalation |

## 1.3 Business model, unit economics & success metrics

### 1.3.1 Revenue model

| Stream | Design | V1 |
|---|---|---|
| **Commission** | Category-wise take rate on order value, configurable per vendor tier | ✅ |
| **Delivery fee** | Customer-paid, waived above a free-delivery threshold | ✅ |
| **Small-basket fee** | Below minimum order value | ✅ |
| **Packaging fee** | Flat per order | ✅ |
| Vendor subscription | Tiered plans for priority placement | Later |
| Ads / promoted placement | Brand and vendor sponsored slots | Later |

### 1.3.2 Illustrative contribution model

All figures are **configuration, not constants** — they live in the pricing module and must be tunable per city without a deploy. Numbers below are the planning model to be validated in pilot.

| Line | Per order |
|---|---|
| Average order value (AOV) | ₹600 |
| Commission @ blended 10% | +₹60 |
| Delivery fee charged to customer | +₹25 |
| Packaging fee | +₹5 |
| **Gross revenue** | **₹90** |
| Delivery cost (3PL or rider payout) | −₹40 |
| Packaging cost | −₹6 |
| Payment gateway @ ~1.2% (prepaid share) | −₹5 |
| Support & comms (WhatsApp/SMS) | −₹3 |
| Refunds & shrinkage @ ~1.5% of AOV | −₹9 |
| COD RTO loss (amortised) | −₹4 |
| **Contribution margin per order** | **≈ ₹23 (3.8% of AOV)** |

**The two levers that decide viability:** AOV (a ₹900 basket roughly doubles contribution, because delivery cost is fixed per order) and delivery cost per order (batching two orders on one trip cuts ₹40 to ~₹24). Both are product problems, not ops problems — which is why §0.3's repeat-basket wedge and §2.8's slot batching are strategic, not cosmetic.

### 1.3.3 Success metrics

**Demand side**
- Time to first purchase (TTFP) < 5 min for new customers
- 30-day repeat rate ≥ 35%; 90-day repeat rate ≥ 40%
- Reorder-assisted baskets ≥ 50% of orders by month 6
- Order completion rate ≥ 90%

**Supply side** *(absent in v1.0)*
- Vendor time-to-first-order < 48 h from approval
- Catalog completeness ≥ 250 mapped offers per vendor
- Vendor acceptance rate ≥ 95% within SLA
- Line-item OOS at picking < 8% (V1 realistic target — see §1.9), trending to < 4%
- 90-day active-vendor retention ≥ 70%

**Fulfilment**
- On-time delivery within slot ≥ 92%
- Order accuracy (no missing/wrong items) ≥ 97%
- Substitution acceptance rate ≥ 60%

**Money** *(absent in v1.0)*
- Contribution margin per order ≥ ₹20 by month 6
- COD RTO rate < 3%
- Refunds < 2% of GMV
- Payout accuracy 100%; settlement on-time ≥ 99%
- Infra cost per 1,000 orders < ₹400

## 1.4 Capacity model and non-functional requirements

### 1.4.1 Capacity — derived, not asserted

v1.0 contained three mutually contradictory scale figures. This is the single derived model; §2 sizes against it.

| Input | Year 1 | Year 2 (must reach without rewrite) |
|---|---|---|
| Registered users | 100,000 | 1,000,000 |
| Monthly active % | 15% | 20% |
| Orders per active user / month | 4 | 4 |
| **Orders / month** | **60,000** | **800,000** |
| **Orders / day (avg)** | **~2,000** | **~26,000** |
| Peak-hour share (grocery peaks 07–10 and 18–21) | 20% | 20% |
| **Orders / peak hour** | **~400** | **~5,300** |
| Session → order conversion | 8% | 8% |
| Sessions / peak hour | 5,000 | 66,000 |
| Concurrent sessions at peak (6 min avg) | ~500 | ~6,600 |
| API calls per session | ~30 | ~30 |
| **Sustained peak RPS** | **~42** | **~550** |
| **Design peak RPS (3× burst headroom)** | **~150** | **~1,650** |

**Pilot (month 0–3):** 1 pincode cluster, 15–25 vendors, target 200 orders/day.

**Conclusion that drives §2.1:** 150 RPS and 2,000 orders/day is served comfortably by a single well-built application on one PostgreSQL instance. The architecture must *reach* 1,650 RPS without a rewrite — a much weaker constraint than building for it now.

**Architecture ceiling:** the modular monolith is expected to serve to ~50,000 orders/day before decomposition is forced. Extraction triggers in §2.1.2 fire well before that.

### 1.4.2 Service level objectives

v1.0's "TTFT < 5 seconds" was both the wrong metric (TTFT is a language-model term) and far too weak.

| Surface | p95 | p99 | Notes |
|---|---|---|---|
| Search & suggest | 200 ms | 500 ms | Measured at API edge |
| Product listing / PDP | 250 ms | 600 ms | |
| Add to cart | 200 ms | 500 ms | |
| Checkout initiate (incl. reservation) | 400 ms | 900 ms | |
| Payment initiate | 800 ms | 2,000 ms | Gateway-bound |
| Order status read | 150 ms | 400 ms | |
| Vendor order list | 300 ms | 800 ms | |

**Frontend budgets** (mid-range Android, 4G, cold cache): LCP < 2.5 s, INP < 200 ms, CLS < 0.1, initial JS ≤ 200 KB gzipped.

**Availability:** 99.9% monthly for core flows (browse, cart, checkout, payment, order status). 99.5% for vendor/admin dashboards. Error budget breach halts feature work in favour of reliability work.

**Durability & recovery:** RPO ≤ 5 min (PITR), RTO ≤ 60 min for core services.

## 1.5 Functional scope — V1

### 1.5.1 Customer

| Capability | Detail |
|---|---|
| Auth | OTP login/registration (phone). Password optional. **No guest checkout in V1** — it complicates order history, the product's core asset |
| Address & serviceability | Save addresses, geocode, serviceability check by polygon; clear "not yet serviceable" state with waitlist capture |
| Home | Search bar, **"Your usual basket"** and **"Buy Again"** above the fold, category shortcuts, offers, recommended |
| Search | Typo-tolerant, transliteration-aware, regional synonyms, filters (price, brand, availability, veg/non-veg), stock-aware ranking |
| Listing & PDP | Image, brand, **net quantity + UoM**, MRP + selling price, savings, per-unit price (₹/kg), stock state, variable-weight notice, veg mark, seller, delivery slot preview |
| Cart | Quantity controls with unit-aware steppers, savings, MOV and delivery-fee progress, **substitution preference**, add-on suggestions |
| Checkout | Address → slot → substitution preference → payment → review. Single screen with progressive disclosure |
| Payment | UPI (intent + collect), COD. Cards/wallets fast-follow |
| Orders | Canonical status timeline, live substitution prompts, rider contact when out for delivery, invoice download, reorder |
| Refunds | Self-serve cancellation within window; refund status tracking |
| Support | In-app ticket + WhatsApp channel; published grievance officer |

### 1.5.2 Vendor

| Capability | Detail |
|---|---|
| Onboarding | Phone OTP → store profile → **FSSAI licence** → GST (or composition/exempt declaration) → bank → documents → admin approval |
| Catalog | **Map to master catalog** — scan barcode or search master; request-new-product queue for unmatched items; assisted bulk seeding from top-SKU templates |
| Inventory | **Three modes** (see §1.9.2): simple toggle / low-stock threshold / true quantity |
| Orders — WhatsApp | Accept/reject, mark line OOS, propose substitution, confirm packed, confirm handover — all via templates with quick replies |
| Orders — dashboard | Queue with filters, picking list, **actual-weight entry**, batch actions, print |
| Slots | Declare capacity per slot, cutoffs, holidays, temporary close |
| Money | Statement: orders, commission, TCS/TDS, adjustments, payout; downloadable |
| Analytics | Daily sales, top products, acceptance rate, OOS rate, prep time |

### 1.5.3 Rider *(entirely new in v2)*

Scope depends on Decision D3 (§1.6). Under the recommended V1 model — vendor self-delivery with 3PL fallback — rider capability is delivered by **WhatsApp + a lightweight PWA**, not a native app:

- Assigned orders list, pickup and drop details, navigation deep-link
- Delivery OTP capture / proof-of-delivery photo
- COD amount to collect (final, post-weighing) and cash-collected confirmation
- Failed-delivery reasons and RTO initiation
- End-of-day cash-in-hand summary

### 1.5.4 Admin / Ops

- Vendor approvals with document and licence-expiry checks; suspension with reason codes
- **Master catalog governance**: create/merge master products, moderate vendor product requests, manage categories, attributes, HSN and GST rates, synonym dictionary
- Live order board with exception filters (unaccepted past SLA, substitution stalled, delivery late, payment stuck)
- **COD risk queue**: threshold and pincode rules, confirmation status, manual override
- Disputes and refunds with approval limits
- Serviceability and slot capacity editor
- Finance: ledger views, settlement runs, reconciliation exceptions, statutory reports

## 1.6 Load-bearing decisions

These four answers determine most downstream design. v1.0 left all four open.

| ID | Decision | Chosen | Rationale | Reversal cost |
|---|---|---|---|---|
| **D1** | Catalog model | **Master product + vendor offer** (§2.4.1) | Without it, search returns duplicate rows per vendor and price comparison is impossible | Very high — full migration |
| **D2** | Cart scope | **Single-vendor cart in V1** | Multi-store means multiple delivery fees, ETAs and invoices — customers reject it, and it adds the hardest 30% of payment/refund/payout work | Medium — parent/sub-order model designed for but not built (§2.4.3) |
| **D3** | Fulfilment | **Vendor self-delivery, with 3PL aggregator as pluggable fallback**; own fleet later | Cheapest launch, no fleet ops, no rider app required. All three sit behind one `FulfilmentProvider` interface | Low by design |
| **D4** | Architecture | **Modular monolith**, extract on trigger (§2.1.2) | Year-1 load is ~150 peak RPS; distribution buys nothing and costs a quarter of engineering time | Low by design |

## 1.7 Grocery-specific mechanics

### 1.7.1 Variable-weight goods *(v1.0: one clause; now specified)*

Loose vegetables, fruit, meat and cut dairy are ordered by intent ("1 kg tomatoes") and delivered by actual weight (0.94 kg). This affects pricing, payment, invoicing and COD.

**Catalog.** `master_product.is_variable_weight`, `pricing_uom` (per kg / per 100 g / per piece), and `weight_tolerance_pct` (default ±10%).

**Customer experience.** Add-to-cart shows: *"Priced per kg. Final price varies with actual weight (±10%). You'll be charged for what's delivered."* Cart and checkout show an **estimated** total with the tolerance band stated.

**Prepaid flow.**
1. **Authorise** the upper bound (estimate × (1 + tolerance)) at checkout.
2. Picker enters actual weight per line; system recomputes.
3. **Capture** the actual amount on packing.
4. If the gateway cannot capture below authorisation: capture the estimate and **auto-refund the delta**. Refunds below ₹5 are absorbed to platform rather than issued.

> **Gateway constraint:** auth/capture with downward adjustment, and an authorisation hold window exceeding the longest slot lead time (target ≥ 7 days), are **hard selection criteria** for the payment gateway. Confirm before contracting.

**COD flow.** Recompute on packing, round to the nearest ₹1, push the final collectable to the rider and to the customer via WhatsApp before dispatch.

**Invoicing.** The tax invoice is generated **after weighing**, on the actual amount — never the estimate.

**Guardrails.** Actual weight outside tolerance requires customer consent (reuse the §1.7.2 substitution prompt). Repeated over-tolerance by a vendor is a quality signal in §6.4.

### 1.7.2 Substitutions *(v1.0: deferred; now V1)*

5–15% of lines go out of stock between order and picking. Without substitution, every one becomes a cancellation and a churned customer.

**Customer preference**, set per order with a saved default:

| Preference | Behaviour on OOS |
|---|---|
| **Auto-substitute** (default) | System proposes best match; picker confirms; customer notified, may reject on delivery |
| **Ask me** | WhatsApp/push prompt with 2–3 options; 10-minute response window; falls back to *Refund item* on timeout |
| **Refund that item** | Line removed, refund issued, order proceeds |

**Substitution rules.**
- Same master category and comparable net quantity (±25%).
- **Never charge more than the original** without explicit consent; if the substitute is cheaper, the difference is refunded.
- Never substitute across veg/non-veg, or across a declared allergen or dietary flag.
- Never substitute a variable-weight item with a packaged one, or vice versa.

**Picker flow.** Mark line OOS → ranked substitute suggestions from in-stock offers → select or skip → system applies the customer's preference.

**Metrics.** Substitution rate, acceptance rate, and refund-on-substitution rate are vendor quality signals (§6.4).

### 1.7.3 Perishables, batches and recall

- `vendor_offer.batch_no`, `expiry_date`, `mfg_date` where applicable.
- **FEFO picking** — first expiry, first out; picking list orders by expiry.
- **Minimum shelf life on delivery**: configurable (default ≥ 30% of total shelf life remaining); shorter-dated stock is auto-delisted or flagged for markdown.
- **Recall workflow**: admin selects master product + batch → system finds all orders containing it → generates customer notification list, blocks further sale, and produces a regulator-ready report. Required for FSSAI compliance and entirely absent from v1.0.

## 1.8 Cancellations, refunds, returns and disputes *(new in v2)*

### 1.8.1 Cancellation

| Order state | Customer may cancel | Fee |
|---|---|---|
| Payment pending / Awaiting vendor | Yes | None |
| Vendor accepted, not packed | Yes | None |
| Packed | Yes, with warning | Configurable (default none in V1) |
| Out for delivery | No — contact support | Case-by-case |
| Delivered | No — use returns |

Vendor-initiated and ops-initiated cancellations require a reason code; vendor cancellation rate feeds §6.4.

### 1.8.2 Refunds

| Method | Route | SLA |
|---|---|---|
| UPI / card prepaid | Original payment method | 3–7 working days (gateway-dependent) |
| COD | Bank transfer or **store credit** | 24 h for store credit; 3–5 days for bank |
| Partial (missing / substituted / underweight) | Same as parent payment | Same |

**Store credit decision:** store credit is faster, cheaper, and improves retention — but a stored-value instrument has RBI prepaid-instrument implications. **V1 uses store credit only as an opt-in alternative to a refund the customer is already owed, with no top-up, no transfer, and expiry ≥ 12 months.** Confirm the structure with counsel before launch.

### 1.8.3 Returns

Perishables generally cannot be restocked. Policy:

- **Refund without return** below a value threshold (default ₹300) for quality complaints, with photo evidence.
- **Return-and-refund** above the threshold or for packaged goods — rider collects on next trip.
- **Abuse detection**: refund frequency per customer, refund-to-order-value ratio, repeat quality complaints against the same customer-vendor pair. Threshold breach routes to manual review rather than auto-approval.

### 1.8.4 Disputes and chargebacks

- Dispute lifecycle: raised → evidence capture (photos, POD, weight log, chat transcript) → ops decision → liability allocation (platform / vendor / rider) → ledger adjustment.
- **Card chargebacks**: gateway webhook → auto-freeze the related vendor payout amount → representment pack assembled from order evidence → deadline tracked. Liability allocation rules must be in the vendor agreement.

## 1.9 Vendor onboarding and adoption model *(new in v2)*

> **This section addresses the riskiest assumption in the whole document.** v1.0 assumed kirana vendors would maintain SKU-level catalogs and real-time stock. Most keep neither. The product must be designed for imperfect inventory rather than assuming it away.

### 1.9.1 Assisted onboarding

1. **Field or tele-onboarding**, not self-serve, for the first 100 vendors.
2. **Catalog seeding, not data entry**: present the master catalog's top ~300 SKUs for the store's category and city; vendor ticks what they stock and sets price. Target: catalog live in under 45 minutes.
3. **Barcode scan** via the vendor PWA for anything outside the template.
4. **Request-new-product** queue for genuinely unmatched items — admin creates the master product, vendor's offer attaches automatically.

### 1.9.2 Tiered inventory modes

Vendors declare `inventory_mode` per store; the platform degrades gracefully.

| Mode | Vendor effort | Platform behaviour |
|---|---|---|
| **Toggle** (default) | In-stock / Out-of-stock switch per item | No reservation; higher substitution rate expected; conservative slot promises |
| **Threshold** | Vendor sets "low stock" flag | Soft reservation; low-stock items deprioritised in ranking |
| **Quantity** | True counts maintained | Full reservation (§2.5); items eligible for tighter slots and promotion |

Ranking rewards higher modes — accurate vendors get more orders. This is the incentive that migrates vendors upward over time, rather than a mandate that makes them churn.

### 1.9.3 WhatsApp-first operations

The vendor's default interface is WhatsApp. Templates required at launch:

`ORDER_NEW` (accept / reject buttons) · `ORDER_REMINDER` (SLA warning) · `ITEM_OOS_PROMPT` · `SUBSTITUTION_PROPOSE` · `ORDER_PACKED_CONFIRM` · `HANDOVER_CONFIRM` · `PAYOUT_STATEMENT` · `LOW_STOCK_DIGEST` (daily)

The vendor PWA dashboard exists from day one but is positioned as the upgrade for multi-staff stores.

### 1.9.4 Vendor SLAs

| Event | SLA | On breach |
|---|---|---|
| Accept order | 10 min (5 min in peak) | Auto-reminder at 5 min → auto-cancel and **auto-reassign to next-best store** at SLA |
| Pack order | Slot-dependent, min 30 min | Escalate to ops |
| Handover to rider | 15 min after rider arrival | Rider records delay; feeds vendor score |
| Respond to substitution | 15 min | Falls back to customer preference |

Three SLA breaches in 7 days → reduced ranking. Ten → suspension review.

## 1.10 Phased rollout *(new in v2)*

| Phase | Scope | Duration | Go/no-go gate to advance |
|---|---|---|---|
| **P0 Alpha** | 1 pincode, 5 friendly vendors, internal + friends & family | 4 weeks | Order flow works end-to-end incl. substitution, variable weight, COD reconciliation |
| **P1 Pilot** | 1 pincode cluster, 15–25 vendors, ~200 orders/day | 8–12 weeks | ≥ 92% on-time; ≥ 35% 30-day repeat; ≥ 70% vendor retention; contribution margin ≥ ₹15/order; OOS at picking < 10% |
| **P2 City** | 1 city, 150–300 vendors, ~2,000 orders/day | 6 months | All P1 gates held at 10× volume; infra cost/1,000 orders < ₹400; support tickets < 8% of orders |
| **P3 Multi-city** | 2–4 cities | — | Playbook repeatable without founder involvement; unit economics positive |

**If P1 gates are missed:** cut multi-vendor ambitions and re-scope to a single-chain white-label product, or pivot the fulfilment model. Named explicitly so the decision is pre-agreed rather than argued under pressure.

---

# 2. Technical Architecture

## 2.1 Architectural style

### 2.1.1 Modular monolith — and why

v1.0 specified 14 microservices, Kafka, Kubernetes, PostgreSQL, MongoDB, Redis and a search index on day one. Against the §1.4 capacity model (~150 peak RPS, ~2,000 orders/day) that is unjustified, and it is the most common way pre-PMF marketplaces fail: months spent on infrastructure instead of product.

**V1 shape:**

- **One deployable** application, horizontally scalable behind a load balancer (start: 2–3 instances).
- **One PostgreSQL** primary + 1 read replica, multi-AZ, PITR enabled.
- **Redis** for cache, sessions, rate limits, distributed locks and the job queue.
- **Typesense** (or OpenSearch) for search.
- **Object storage** (S3-compatible) for images and documents.
- **Managed container platform** — ECS/Fargate, Cloud Run or App Runner. **Kubernetes is explicitly not required** at this scale.

The fourteen bounded contexts from v1.0 are **preserved exactly** as module boundaries. The domain thinking was right; only the deployment topology changes.

**Module boundary rules — enforced, not aspirational:**

1. A module owns its tables. **No other module may read or write them directly** — enforced by schema-per-module plus a CI check on cross-schema references.
2. Cross-module calls go through a published interface (one file per module: `contracts/<module>.ts` or equivalent).
3. Cross-module writes that must be atomic use a single DB transaction; anything else goes through the **outbox** (§2.13).
4. No circular dependencies between modules — enforced in CI by a dependency-graph lint.
5. Each module has its own test suite runnable in isolation.

These rules mean extraction to a service is later a matter of moving code and swapping the interface implementation for an HTTP/gRPC client — not an archaeology project.

### 2.1.2 Service extraction triggers — published in advance

Extract a module into its own deployable **only** when a trigger fires. Publish this table so the decision is data-driven, not architectural fashion.

| Module | Extraction trigger |
|---|---|
| `search` | Catalog > 200K offers **or** search p95 > 200 ms sustained for 7 days |
| `payment` + `cod-oms` | Separate compliance/audit scope needed, **or** independent on-call rotation formed |
| `notification` | Outbound volume adds > 50 ms p95 to request path, **or** > 500 msg/min sustained |
| `analytics` | Reporting queries measurably contend with transactional load |
| `delivery` | Own fleet adopted (D3 option c) **or** live-location ingest > 100 events/sec |
| `catalog` | Catalog write throughput blocks order-path deploys |
| Everything else | Only when a dedicated team owns it full-time |

**Also extract when:** deploy frequency of one module is throttled by another's test suite, or a module needs a fundamentally different runtime (e.g. a Python ML service).

## 2.2 Module map (bounded contexts)

| Module | Owns | V1 |
|---|---|---|
| `identity` | Auth, OTP, sessions, JWT/refresh, roles, permissions | ✅ |
| `user` | Customer profiles, addresses, preferences, consent records | ✅ |
| `vendor` | Vendor accounts, KYC/FSSAI/GST, store config, staff, SLA scores | ✅ |
| `catalog` | **Master products**, categories, attributes, HSN/GST mapping, moderation queue | ✅ |
| `offer` | **Vendor offers** — price, stock, batch/expiry, per-slot availability | ✅ |
| `search` | Index, query, synonyms, transliteration, ranking | ✅ |
| `pricing` | Selling price rules, discounts, coupons, fees (delivery/MOV/packaging) | ✅ |
| `cart` | Cart state, substitution preference, validation | ✅ |
| `serviceability` | Geofences, store-to-address resolution, **slot definitions and capacity** | ✅ |
| `checkout` | Orchestration: validate → reserve → price → tax → pay → create order | ✅ |
| `order` | Canonical order + line items, state machine, substitutions, actual weights | ✅ |
| `inventory` | Reservations, holds, release, oversell prevention | ✅ |
| `payment` | Gateway integration, auth/capture, webhooks, refunds | ✅ |
| `cod` | COD risk scoring, confirmation (WhatsApp/IVR/OTP), recovery | ✅ |
| `delivery` | **Fulfilment provider abstraction**, assignment, tracking, POD, RTO | ✅ |
| `tax` | GST computation, HSN resolution, invoice generation, TCS/TDS | ✅ |
| `ledger` | **Double-entry ledger** — the financial source of truth | ✅ |
| `settlement` | Payout cycles, reconciliation, COD cash, vendor statements | ✅ |
| `notification` | WhatsApp, push, SMS (DLT), email, in-app; templates and preferences | ✅ |
| `support` | Tickets, disputes, refunds workflow, grievance tracking | ✅ |
| `analytics` | Event ingestion, warehouse sync, KPI surfaces | ✅ |
| `admin` | Backoffice orchestration over the above | ✅ |

## 2.3 Technology stack *(v1.0 declined to choose; deciding here)*

| Layer | Choice | Why |
|---|---|---|
| Backend | **TypeScript / Node.js 22 LTS (NestJS)** — *decided, OD-1* | NestJS modules are a first-class expression of §2.1.1's boundary rules; shared types with all four TS frontends; best SDK coverage for Indian payments, WhatsApp and Typesense; largest fungible hiring pool. Adequate for the §1.4.1 Year-2 target (I/O-bound at ~1,650 RPS) |
| ORM / DB access | **Drizzle** (or Prisma) | Type-safe queries whose generated types flow into the shared `contracts` package |
| AI / ML | **None in the MVP** (§2.17) | Every V1 capability is SQL, rules or off-the-shelf search. When adopted later: TypeScript calling an LLM API from inside the monolith — no Python service, no ML infrastructure |
| Primary DB | **PostgreSQL 16+** | ACID for money; JSONB covers flexible catalog attributes; PostGIS covers serviceability |
| Cache / queue / locks | **Redis 7** | One dependency for four jobs |
| Search | **Typesense** (V1) → OpenSearch if customisation demands | Typo tolerance and sub-50 ms out of the box, a fraction of ES ops burden |
| Object storage | S3-compatible | |
| Customer frontend | **PWA (Next.js)** first; native shell later | §4.1 — reach, install-free, updateable; native only when push/perf demands |
| Vendor & rider | **PWA** + WhatsApp templates | Kirana owners will not install an app |
| Admin | React SPA | |
| Infra | Managed containers (ECS/Fargate or Cloud Run) + managed Postgres/Redis | |
| IaC | Terraform | |
| CI/CD | GitHub Actions → staging → prod with approval | |

**Repository layout** — monorepo, one CI:

```
freshkirana/
  packages/
    contracts/       # shared TS types: API, domain events, order states, Money
    api/             # NestJS modular monolith — the 22 modules of §2.2
    web-customer/    # Next.js PWA
    web-vendor/      # Next.js PWA
    web-rider/       # Next.js PWA
    web-admin/       # React SPA
  infra/             # Terraform
```

`packages/contracts/` is the reason TypeScript wins here: the §2.6 state machine, money types and event schemas are defined once and compile-checked across the API and all four frontends.

**Removed from v1.0:** MongoDB (PostgreSQL JSONB + Typesense covers catalog flexibility; two primary stores buys dual-write bugs, not flexibility) and Kafka (replaced by transactional outbox + Redis Streams until a real streaming consumer exists).

## 2.4 Core data model

### 2.4.1 Catalog — master product + vendor offer *(Decision D1)*

```
master_product
  id, slug, brand_id, name, name_i18n(jsonb)
  category_id, attributes(jsonb)
  net_quantity, uom            -- 5, 'kg'
  is_variable_weight, pricing_uom, weight_tolerance_pct
  ean_barcode, hsn_code, gst_rate_pct
  veg_mark                      -- veg | non_veg | egg
  -- Legal Metrology declarations (§3.7):
  manufacturer_packer, country_of_origin, consumer_care_contact
  images[], status, created_by_admin
```

```
vendor_offer                    -- one per (vendor, master_product)
  id, vendor_id, master_product_id
  mrp, selling_price
  inventory_mode                -- toggle | threshold | quantity
  stock_on_hand, stock_reserved, low_stock_threshold
  batch_no, mfg_date, expiry_date
  is_available, slot_availability(jsonb)
  status, updated_at
```

Search indexes **master products**; vendor offers are resolved at render time for the customer's serviceable stores (cheapest / nearest / best-stocked per §2.7.3). Price comparison, deduplicated search, and clean analytics all follow from this split.

**Product request queue:** a vendor scanning an unmatched barcode creates a `product_request`; admin approves → master product created → the vendor's offer attaches automatically. A nightly dedupe job flags likely-duplicate master products by EAN, brand+name fuzzy match, and net quantity.

### 2.4.2 Order

```
order
  id, order_no, customer_id, vendor_id     -- single vendor (D2)
  address_snapshot(jsonb), slot_id, slot_window
  status, payment_status                   -- orthogonal axes (§2.6)
  substitution_preference
  amounts: items_estimated, items_actual, delivery_fee, packaging_fee,
           mov_fee, discount, tax_total, grand_total_estimated,
           grand_total_actual
  cod_amount_collectable, fulfilment_provider, invoice_id
  placed_at, accepted_at, packed_at, dispatched_at, delivered_at

order_line
  id, order_id, vendor_offer_id, master_product_id
  qty_ordered, uom, unit_price, mrp
  is_variable_weight, weight_ordered, weight_actual
  line_status                              -- pending | picked | oos |
                                           -- substituted | refunded | cancelled
  substituted_by_offer_id, substitution_price_delta
  tax_rate, tax_amount, line_total_estimated, line_total_actual
  batch_no, expiry_date
```

Line-level status is what makes partial fulfilment, partial refunds, and per-line substitution possible — all impossible under v1.0's order-level-only model.

### 2.4.3 Multi-vendor forward compatibility

Though D2 fixes V1 at one vendor per order, the schema reserves `order.parent_order_id` (nullable). When multi-vendor arrives, a customer transaction becomes a parent order with one child order per vendor; payment allocation, refunds, invoicing and payouts are already modelled at child-order level. No migration required.

### 2.4.4 Ledger

```
ledger_account       -- platform_revenue, vendor_payable(vendor_id),
                     -- customer_refund_payable, cod_cash_in_transit(rider_id),
                     -- gst_tcs_payable, tds_payable, gateway_receivable, ...
ledger_entry         -- id, txn_id, account_id, debit, credit, currency,
                     -- ref_type, ref_id, posted_at, description
```

Every order, refund, commission, fee, tax deduction, penalty and cash movement posts a balanced journal entry. **Payouts are computed from the ledger, never by summing order rows** — the single most important control in §2.11.

## 2.5 Inventory reservation and concurrency *(v1.0: one word; now specified)*

Grocery stock is often 1–5 units. Without an explicit design, two simultaneous checkouts oversell.

**Where reservation happens:** at **checkout initiation**, not add-to-cart. Cart holds cause phantom out-of-stock for everyone else and are the most common design error here.

**Concurrency control:** optimistic locking on `vendor_offer.version` with bounded retry (3 attempts, jittered backoff). Falls back to `SELECT … FOR UPDATE` on the offer row for hot SKUs identified by contention metrics.

**Reservation lifecycle**

```
reservation(id, order_id, vendor_offer_id, qty, status, expires_at)
   CREATED ──payment success──> CONFIRMED ──vendor packs──> CONSUMED
      │
      ├── payment failure / timeout ──> RELEASED
      └── TTL expiry (sweeper) ─────── > RELEASED
```

- **TTL:** 10 minutes for prepaid (covers UPI collect latency), 15 for COD-with-confirmation.
- **Sweeper:** runs every 60 s, releases expired holds, emits `reservation.expired`.
- **Idempotency:** every reserve / confirm / release carries an idempotency key; retries cannot double-decrement.
- **Mode-aware:** only `inventory_mode = quantity` offers reserve. `toggle` and `threshold` offers skip reservation and accept higher substitution rates — the deliberate trade of §1.9.2.

**Oversell policy.** If stock vanishes between reservation and picking, it is handled as a normal substitution event (§1.7.2), not an error. The customer never sees a system failure message for an inventory condition.

## 2.6 Canonical order state machine *(v1.0 had two conflicting vocabularies)*

Fulfilment status and payment status are **orthogonal axes**. Conflating them is a classic and expensive mistake.

### 2.6.1 Fulfilment status

```
DRAFT
  └─> PENDING_PAYMENT ──payment ok──> AWAITING_VENDOR
        │                                   │
        │                            ┌──────┴──────┐
        │                       accepted        rejected/SLA breach
        │                            │              │
        │                            v              v
        │                        ACCEPTED      REASSIGNING ──> AWAITING_VENDOR
        │                            │                     └──> CANCELLED
        │                            v
        │                     PICKING ──oos──> SUBSTITUTION_PENDING ──> PICKING
        │                            │
        │                            v
        │                         PACKED ──(final capture / COD amount set)
        │                            │
        │                            v
        │                     READY_FOR_PICKUP ──> DISPATCHED
        │                            │                 │
        │                            v                 v
        │                       COMPLETED          DELIVERED ──> COMPLETED
        │                       (pickup)               │
        │                                     delivery failed
        │                                              v
        │                                     DELIVERY_FAILED ──> RTO ──> RETURNED
        └─payment failed/timeout──> CANCELLED

Any state (per rules in §1.8.1) ──> CANCELLED
COMPLETED ──return raised──> RETURN_REQUESTED ──> RETURNED
```

### 2.6.2 Payment status

`PENDING → AUTHORISED → CAPTURED → {PARTIALLY_REFUNDED, REFUNDED}`, with `FAILED` from `PENDING`/`AUTHORISED`. COD orders sit at `PENDING` until `COD_COLLECTED`, then `CAPTURED`.

### 2.6.3 Role-specific labels

One canonical state; each audience sees its own vocabulary. No parallel state machines.

| Canonical | Customer sees | Vendor sees | Rider sees |
|---|---|---|---|
| AWAITING_VENDOR | Confirming with store | **New order** | — |
| ACCEPTED | Confirmed | Accepted | — |
| PICKING | Being packed | Picking | — |
| SUBSTITUTION_PENDING | Item unavailable — your choice needed | Awaiting customer | — |
| PACKED | Packed | Ready for handover | Ready for pickup |
| DISPATCHED | Out for delivery | Handed over | Delivering |
| DELIVERED | Delivered | Completed | Delivered |

**Transition table.** Each transition declares: allowed roles, guard conditions, side effects (ledger posting, notification, reservation change), and events emitted. Held in code as a single declarative table and covered by exhaustive tests — no transition may be triggered by an ad-hoc status write.

## 2.7 Search design *(v1.0: one phrase)*

Search drives the majority of grocery sessions, and Indian grocery search is genuinely hard.

### 2.7.1 Engine

**Typesense** for V1: typo tolerance, sub-50 ms, and a fraction of the operational burden of Elasticsearch. Migration path to OpenSearch is documented if custom scoring outgrows it. PostgreSQL full-text is **not** sufficient here.

### 2.7.2 Indian-language handling

- **Transliteration**: `atta` / `aata` / `आटा` must all match. Maintained as an editable synonym set, not code.
- **Regional names**: `kanda`→onion, `bhindi`→okra, `jeera`→cumin, `dhaniya`→coriander, `methi`→fenugreek, seeded per launch city.
- **Brand-vs-category disambiguation**: "Amul" (brand) vs "butter" (category) vs "Amul butter".
- **Unit normalisation**: "1kg", "1 kg", "one kilo", "kilo" all resolve.
- The **synonym dictionary is data, editable by ops without a deploy** — this is a launch requirement, not an optimisation.

### 2.7.3 Ranking

Ranked over master products, then resolved to offers:

1. **Hard filter**: serviceable to this address (§2.8).
2. **Availability as a ranking signal** — an out-of-stock offer never outranks an in-stock one. `inventory_mode = quantity` vendors get a ranking bonus (the §1.9.2 incentive).
3. Text relevance, then personal purchase history (bought-before boost), then price competitiveness, then vendor quality score (§6.4), then distance.

### 2.7.4 Freshness and failure

- Offer stock/price changes reflected in the index within **≤ 10 s** (event-driven partial update, not full reindex).
- Nightly full reindex with a versioned alias for atomic swap.
- **Zero results**: spell correction → category fallback → "notify me when available" capture (which becomes a demand signal for vendor catalog expansion).
- Search health metrics: zero-result rate, search→ATC conversion, top failed queries. Failed queries feed the synonym dictionary weekly.

## 2.8 Serviceability, slots and capacity *(new in v2)*

### 2.8.1 Serviceability

- Store service area as a **PostGIS polygon** (preferred) or radius fallback.
- Address → serviceable stores resolution, ranked by distance, catalog coverage of the customer's typical basket, and vendor quality score.
- Non-serviceable addresses get a clear message plus **waitlist capture** — the primary input to expansion decisions in §1.11.

### 2.8.2 Slot capacity model

Slot capacity is the **minimum of picking capacity and delivery capacity**, and both must be modelled — v1.0 modelled neither.

```
slot_definition(store_id, day_of_week, start, end,
                picking_capacity_orders, cutoff_minutes_before)
slot_instance(id, store_id, date, window,
              capacity, booked, status)   -- open | full | closed | blackout
```

- Capacity decrements atomically at checkout (same transaction as reservation).
- **Cutoff**: slot closes N minutes before start (default 90).
- **Blackouts**: vendor holidays, festivals, ops-declared surge closures.
- **Over-commit protection**: if a vendor breaches pack SLA repeatedly in a day, remaining slots auto-close for that store.
- **UX**: full slots shown greyed with the next available highlighted — never a silent failure at checkout.

## 2.9 Delivery and fulfilment *(entirely absent from v1.0)*

### 2.9.1 Provider abstraction

All three fulfilment models sit behind one interface, so D3 is cheaply reversible:

```
interface FulfilmentProvider {
  quote(order): { cost, eta, feasible }
  dispatch(order): { assignmentId, riderRef? }
  track(assignmentId): { status, location?, eta }
  cancel(assignmentId): void
  proofOfDelivery(assignmentId): { otpVerified, photoUrl?, collectedCash? }
}
```

Implementations: `VendorSelfDelivery` (V1 default), `ThirdPartyAggregator` (fallback — Shadowfax / Porter / Borzo class), `OwnFleet` (later).

### 2.9.2 Assignment and batching

- V1: vendor's own delivery person, assigned by the vendor via WhatsApp or dashboard.
- 3PL fallback triggers automatically when the vendor declines delivery or breaches handover SLA.
- **Batching** (P2): orders in the same slot, same store, within a distance radius are grouped into one trip. This is the single biggest lever on the §1.3.2 delivery cost line — ₹40 → ~₹24 at two orders per trip.

### 2.9.3 Tracking, proof of delivery, and failure

- Rider location ingested only while an assignment is active; **purged after delivery + 7-day audit window** (§3.6 — location is personal data).
- Customer sees status milestones in V1; live map is fast-follow, not V1.
- **Proof of delivery**: 4-digit OTP read to the rider (default), or photo where the customer opts for contactless.
- **Delivery failure** reasons: customer unavailable, address unreachable, refused, COD amount not available. One retry attempt where feasible, then **RTO** — stock return to vendor, refund per §1.8, RTO cost allocated per the vendor agreement.

## 2.10 Payments

### 2.10.1 Methods

| Method | V1 | Notes |
|---|---|---|
| UPI intent (app switch) | ✅ | Primary; highest success rate |
| UPI collect | ✅ | Fallback; longer latency — drives the 10-min reservation TTL |
| COD | ✅ | With confirmation flow (§2.10.4) |
| Cards | Fast-follow | Requires RBI-compliant tokenisation (§3.5) |
| Wallets / netbanking | Fast-follow | |

### 2.10.2 Gateway selection criteria

Non-negotiable, driven by §1.7.1:

1. **Auth/capture with downward-adjusted capture** (variable weight).
2. **Authorisation hold window ≥ 7 days**.
3. Partial refunds and multiple refunds against one payment.
4. Signed webhooks with replay protection.
5. Machine-readable daily settlement file for reconciliation (§2.11.3).
6. UPI intent + collect, with a smart-link recovery flow.

### 2.10.3 Failure recovery

UPI failure is common and directly costs revenue. On failure:
1. Immediate retry offer with an alternative UPI app.
2. **Smart payment link** via WhatsApp, valid for the reservation TTL.
3. For customers above a trust score, **offer conversion to COD** rather than losing the order.
4. Order held in `PENDING_PAYMENT` until TTL, then cancelled with reservation release.

### 2.10.4 COD risk and confirmation

Risk scoring inputs: order value, customer order history and RTO history, pincode RTO rate, address quality, account age, delivery-distance outlier, and item mix.

| Risk band | Action |
|---|---|
| Low | Auto-confirm |
| Medium | WhatsApp confirmation with quick-reply buttons; 30-min window |
| High | OTP or IVR confirmation required before vendor acceptance |
| Blocked | COD unavailable; prepaid only, shown transparently at checkout |

Thresholds (value, pincode list, score cutoffs) are **ops-configurable without deploy**. Every decision and override is audit-logged.

## 2.11 Ledger, settlement and COD cash *(v1.0: one line)*

> COD is the hardest operational problem in Indian e-commerce: the rider holds the customer's cash, the vendor is owed the goods value, and the platform is owed commission on money it never touched. v1.0 left this a blank page.

### 2.11.1 Ledger as source of truth

Every financial event posts a balanced double-entry transaction. Examples:

**Prepaid order delivered (₹600 items, ₹25 delivery, ₹60 commission):**
```
Dr gateway_receivable          625
   Cr vendor_payable(V)                540   (600 − 60 commission)
   Cr platform_revenue                  85   (60 commission + 25 delivery)
```

**COD order delivered (₹600):**
```
Dr cod_cash_in_transit(R)      625
   Cr vendor_payable(V)                540
   Cr platform_revenue                  85
```
**Rider deposits cash:**
```
Dr bank                        625
   Cr cod_cash_in_transit(R)           625
```
A non-zero `cod_cash_in_transit(R)` after the deposit deadline **is** the shortfall, surfaced automatically. No spreadsheet required.

### 2.11.2 Settlement cycles

| Payment type | Cycle | Conditions |
|---|---|---|
| Prepaid | **T+3** from delivery | After gateway settlement received and reconciled |
| COD | **T+7** from delivery | After rider cash reconciled to bank |
| Disputed orders | Held | Released on dispute resolution |
| Chargeback exposure | Reserve % held per vendor | Configurable, default 2% rolling 30 days |

Payouts are computed **from ledger account balances**, net of commission, TCS, TDS, penalties and adjustments.

### 2.11.3 Reconciliation — three loops, all automated

1. **Gateway**: import daily settlement file → match to payments → exceptions queue for mismatches, missing settlements, unexpected credits.
2. **COD cash**: rider collections → cash-in-hand → deposit reference → bank credit → matched. Shortfalls tracked per rider with escalation at 24 h.
3. **Vendor statement**: opening balance → orders → deductions → adjustments → payout → closing. Downloadable; must tie to the ledger exactly.

Any unreconciled item older than 48 h raises an ops alert. Reconciliation completeness is a §6 daily-standup metric.

## 2.12 Notifications

**Channels and priority:** WhatsApp → Push → SMS → Email, with per-event fallback chains.

**WhatsApp Business API** is the primary channel for both customers and vendors (§0.3, §1.9.3). Requires a BSP, template pre-approval (allow 1–2 weeks lead time in the plan), and per-template opt-in tracking.

**SMS requires TRAI DLT registration** — entity registration, sender ID, and per-template registration are mandatory in India, with lead time. Transactional vs promotional classification affects DND applicability. **This is a launch blocker if started late** and was unmentioned in v1.0.

Also required: per-channel preference centre, quiet hours (default 21:00–08:00 for non-critical), opt-out honoured across channels, and a delivery-receipt log for dispute evidence.

## 2.13 Integration and events

- **Transactional outbox**: domain events written in the same transaction as the state change, then relayed by a worker. Guarantees no lost events without distributed transactions.
- **Redis Streams** as the V1 bus; consumer groups per subscriber; dead-letter stream with alerting.
- **At-least-once delivery** — all consumers must be idempotent.
- Event catalogue versioned in `contracts/events/`, e.g. `order.placed`, `order.accepted`, `line.substituted`, `weight.recorded`, `payment.captured`, `delivery.completed`, `cod.collected`, `reservation.expired`.
- Kafka is introduced only when a genuine streaming consumer exists (§2.1.2).

## 2.14 Deployment, scaling and cost

- Containerised app on a managed platform; autoscale on CPU + request concurrency; min 2 instances for HA.
- Managed PostgreSQL, multi-AZ, one read replica for analytics/reporting reads; PITR.
- CDN in front of images and static assets; signed URLs for documents.
- Blue-green or rolling deploys, automated rollback on error-rate breach.
- **Cost target:** < ₹400 infra per 1,000 orders. Tracked monthly as a §1.3.3 metric — this is also the ongoing evidence for or against the §2.1 architecture choice.

## 2.15 Environments, testing and release *(new in v2)*

| Environment | Purpose | Data | Payments |
|---|---|---|---|
| Local | Development | Seeded fixtures | Gateway sandbox |
| Dev | Integration | Synthetic | Sandbox |
| Staging | Pre-prod, load tests | Anonymised prod-shaped | Sandbox |
| Prod | Live | Real | Live |

**Test strategy**
- Unit tests per module; **contract tests on every published module interface** (these are what make extraction safe later).
- Integration tests for the four critical paths: checkout+reservation, substitution+partial refund, variable-weight capture, COD collect→reconcile.
- E2E on: happy-path prepaid, COD with confirmation, substitution accepted, substitution refunded, cancellation, RTO.
- **Load tests** against §1.4.1 targets — peak-hour ordering burst, search under catalog load, slot-booking contention (many customers, one slot).
- **Chaos drills**: gateway down, WhatsApp API down, search down, replica lag. Each must degrade gracefully, not fail the order.

**Release:** trunk-based, feature-flagged, staged rollout (internal → 5% → 50% → 100%), documented rollback. Migrations must be backward-compatible for one release (expand/contract).

## 2.16 Observability

- **Structured logs** with correlation IDs propagated across module boundaries and into the outbox.
- **Metrics**: RED per endpoint, plus business metrics (orders/min, payment success %, OOS rate, substitution rate, slot fill %, reconciliation backlog).
- **Traces** across module calls and external gateways.
- **Alerts** on SLO burn rate, payment success drop, order-acceptance backlog, reconciliation age > 48 h, reservation-sweeper lag, COD shortfall.
- **Dashboards**: engineering (SLO), ops (live order board), business (§1.3.3 metrics), finance (ledger and reconciliation).

## 2.17 AI/ML — deferred, with the seam held open *(v2.2)*

**Decision: the MVP ships with no AI.** No Python service, no ML pipeline, no LLM provider, no embeddings. Every V1 capability is delivered by SQL, deterministic rules, or off-the-shelf search — and none of them is degraded by the absence of AI (§2.17.1).

When AI is added, it will be **TypeScript calling an LLM API from inside the monolith** (§2.17.5) — the separately-deployed Python service proposed in v2.1 is no longer required, because every intended use is either batch or a single low-latency call.

This section exists to make "later" cheap. The total cost of keeping the door open is **the three interfaces in §2.17.2 (about half a day)**, plus analytics events that are already mandated for other reasons.

### 2.17.1 What is, and is not, AI in V1

The four V1 features that sound like AI are heuristics and rules. **They ship in the MVP** — the ML service later replaces their implementation, it does not introduce them.

| Capability | V1 implementation — **no AI** | Quality cost of skipping AI | AI version, later |
|---|---|---|---|
| **"Your usual basket"** (§0.3 — the differentiator) | SQL: item purchase frequency × median repurchase interval | **None** | Next-basket model (ReCANet-class) |
| **COD risk scoring** (§2.10.4) | Weighted rules on value, RTO history, pincode, account age | **None** — rules are *preferable* here: deterministic, auditable under §3.8, < 50 ms | Gradient-boosted model (exportable to ONNX; still no Python service at runtime) |
| **Search typo tolerance** (§2.7.1) | Typesense built-in | **None** | — |
| **Regional synonyms** (§2.7.2) | ~300 terms curated manually with a native speaker — one day's work | **None — manual is better at V1.** With no query data yet, hand-curation grounded in real local usage beats generated lists | LLM-generated expansion once failed-query data exists |
| **Catalog dedupe** (§2.4.1) | EAN barcode match + PostgreSQL `pg_trgm` fuzzy match | **None at V1 catalog size** (~3–5K master products) | Embeddings + pgvector past ~20K products |
| **Substitute ranking** (§1.7.2) | Rules: same category, ±25% net qty, price ≤ original, in stock | **Small** — rules will be adequate; an LLM judges brand-level substitutability better | LLM, precomputed offline into a candidate table |
| **Voice search** | Web Speech API (browser-native, free, supports `hi-IN`) → text → existing search | **None** — needs no AI provider | — |
| **Voice ordering** (spoken multi-item list) | Not in V1 | Deferred feature | ASR + LLM parsing |
| **Conversational WhatsApp ordering** | Not in V1 | Deferred feature | LLM |

> **Guardrail 1:** "Your usual basket" is **not AI** — it is a SQL query, and it is the §0.3 wedge. It must not be filed under "AI, do later." Doing so launches FreshKirana as a generic marketplace.

> **Guardrail 2:** Speech-to-text is a **separate provider** from any LLM (DeepSeek and most LLM APIs are text-only). Voice ordering will require an ASR vendor — Sarvam AI or AI4Bharat for Indian-language coverage, or Google STT. Budget for it when voice is scheduled, not before.

### 2.17.2 Interfaces defined in V1

The core declares these interfaces in Phase 1 and ships heuristic implementations. Swapping in ML is a binding change, not a refactor.

```ts
interface BasketPredictor { predict(customerId): PredictedBasket }
interface SubstituteRanker { rank(offerId, ctx): Offer[] }
interface RiskScorer      { score(order): RiskBand }
```

### 2.17.3 Adoption triggers — add AI on evidence, not on a calendar

Mirrors the §2.1.2 service-extraction discipline. Nothing below is scheduled; each is adopted only when its trigger fires.

| Capability | Trigger |
|---|---|
| LLM substitute ranking | Substitution acceptance rate < 60% (§1.3.3 target) **and** rules tuning has plateaued |
| LLM synonym generation | Search zero-result rate > 5% **and** manual curation cannot keep pace with failed-query volume |
| Embeddings + pgvector dedupe | Master catalog > 20,000 products, **or** duplicate-merge queue exceeds ops capacity |
| Voice search | No trigger — cheap and provider-free; schedule whenever frontend capacity allows |
| Voice ordering | Voice search adoption > 20% of sessions, **or** literacy/accessibility demand appears in support tickets |
| Conversational WhatsApp ordering | WhatsApp becomes a genuine customer order channel rather than a notification channel |
| ML fraud model | COD RTO > 3% (§1.3.3) **and** rule tuning has plateaued |

### 2.17.4 Keeping the door open — the four MVP prerequisites

| # | Requirement | Added cost | Why it must be in the MVP |
|---|---|---|---|
| 1 | **Analytics events (§5.1)** | Already mandated | **Irreversible.** Any future model trains on data that was either captured or was not; untracked launch months cannot be recovered |
| 2 | **Declare the three §2.17.2 interfaces**, with rule implementations behind them | **~half a day** | Adding AI becomes a new class plus a config flag, not a refactor |
| 3 | **Record substitution outcomes** — proposed, accepted, rejected | Already in `order_line` (§2.4.2) + events (§5.1) | This *is* the training set for the LLM substitute ranker |
| 4 | **Log search queries with a zero-result flag** | Already in §5.1 | Tells you which synonyms to add manually now, and whether AI would help later |

Items 1, 3 and 4 already exist in this document for independent reasons. **The genuine incremental cost of keeping AI open is item 2.**

Secondary enablers already in the architecture and requiring no action: immutable order and line history (§2.4.2), the read replica (§2.14), and **pgvector available in PostgreSQL** whenever embeddings are eventually wanted — no additional infrastructure.

### 2.17.5 Provider routing when AI is adopted *(decided in advance, OD-11)*

Route by **data sensitivity**, not by provider preference. This preserves the cost advantage of a low-cost provider across the 90% of volume that touches no personal data, while keeping the PII path compliant with §3.6.

| Workload | Data sent | Provider |
|---|---|---|
| Synonym generation | Product names only | **No PII → DeepSeek** |
| Substitute precompute | Catalog data only | **No PII → DeepSeek** |
| Catalog dedupe / embeddings | Product names, brands | **No PII → DeepSeek** |
| Voice ordering, conversational ordering | Customer speech, history, address | **PII → provider with an enterprise DPA and an acceptable residency position.** DeepSeek processes data in China; under DPDP this requires a processor agreement, falls within cross-border transfer rules, and must be disclosed in the consent notice |

Implementation constraints for any adopted AI:

- Behind an `LlmProvider` interface so providers are swappable per workload.
- **Precompute, never call per request** where the answer is stable (substitute lists change rarely; nightly generation removes 1–2 s from the picking flow and cuts cost by orders of magnitude).
- **No LLM call in the order path without a fallback**: timeout ≤ 2 s, one retry, then the §2.17.1 rule implementation. An LLM outage must never block a checkout.
- **Prompt injection**: vendor-supplied product names and descriptions are untrusted input. Constrain model output to an ID drawn from a supplied candidate list and validate the response against that list before acting on it.
- Per-feature cost cap with a monthly budget alert.

---

# 3. Security, Access & Compliance

## 3.1 Authentication

- Phone + OTP as primary; optional password as a secondary factor for vendor/admin.
- **Access token** (JWT, 15 min) + **refresh token** (30 days, rotating, HttpOnly + Secure + SameSite cookie), with reuse detection revoking the family.
- **Admin, finance and fleet-manager roles require MFA** (TOTP) — not present in v1.0.
- Device/session list with remote revoke for customers and vendors.
- No guest checkout in V1 (§1.5.1).

## 3.2 Authorisation (RBAC)

Roles: `customer`, `vendor_owner`, `vendor_staff`, `rider`, `fleet_manager`, `admin`, `ops`, `finance`, `support`.

- **Service-level** permission checks plus **resource-level** scoping — vendor staff may access only their own store's offers and orders; riders only their active assignments; support only tickets in their queue.
- Permissions are declarative per endpoint and covered by authorisation tests (a missing check must fail CI, not production).
- **Deny by default.** New endpoints are inaccessible until a permission is declared.

## 3.3 Abuse prevention and API hardening *(new in v2)*

| Vector | Control |
|---|---|
| **OTP abuse / SMS pumping** | Per-phone (5/hr, 15/day) and per-IP limits, exponential backoff, cooldown, CAPTCHA escalation after 3 failures, device fingerprinting, blocked-prefix list. **Direct cash drain if left open** |
| **Idempotency** | Mandatory `Idempotency-Key` on order creation, payment initiate, refund, and all inventory mutations |
| **Webhook security** | Signature verification **plus** timestamp window + nonce replay cache; out-of-order tolerance; at-least-once handling |
| **Rate limiting** | Global per-IP and per-user token buckets at the gateway; stricter buckets on auth, search and checkout |
| **Bot / scraping** | WAF, bot detection, catalog-scrape defence (competitors will scrape prices); progressive throttling rather than hard blocks |
| **Coupon abuse** | Single-use enforcement with atomic claim, per-user caps, stacking rules, device+payment-instrument dedupe |
| **Vendor fraud** | Self-ordering detection (same device/payment/address rings), phantom stock detection via OOS-rate outliers, rating-manipulation detection |
| **Customer refund abuse** | Refund frequency and ratio thresholds → manual review queue (§1.8.3) |
| **Rider fraud** | Cash shortfall tracking, POD anomaly detection, delivery-location vs customer-address mismatch |
| **Secrets** | Managed secret store, rotation schedule, no secrets in env files or repo, CI secret scanning |

## 3.4 Payment and COD security

- Official PSPs only; validate callback signatures; never trust client-reported payment status — always verify server-side against the gateway.
- **VPA verification** for QR/collect flows; publish the official VPA as a customer-verifiable channel.
- **Internal control:** staff may not approve collect requests they did not initiate (segregation of duties, carried forward from v1.0 — a genuinely good control).
- Velocity and anomaly rules: order frequency, value spikes, many addresses on one account, many accounts on one device.
- COD: risk bands per §2.10.4; audit trail on every confirmation, override and cancellation.

## 3.5 Data protection

- **PII minimisation** — collect only what's needed; no PAN/Aadhaar unless a specific statutory need is documented.
- **Encryption**: TLS 1.2+ in transit; at rest via managed KMS; application-level encryption for phone numbers and address text.
- **No card storage.** RBI card-on-file tokenisation via the gateway only; the platform stores tokens and last-4/network only.
- **Rider location is personal data** — retained only for the active assignment plus a 7-day audit window, then purged.
- Access to production PII is role-gated, MFA-protected, and logged. Non-prod uses anonymised data only.

## 3.6 DPDP Act 2023 compliance *(absent from v1.0)*

India's Digital Personal Data Protection Act, 2023 imposes operational requirements that need **built features**, not policy paragraphs. Rules have been phasing in — confirm current obligations and timelines with counsel.

| Requirement | What must be built |
|---|---|
| **Itemised consent notice** | Signup consent screen, purpose-specific, in English + regional languages; consent version recorded per user |
| **Withdrawal as easy as granting** | Self-serve consent management in account settings |
| **Right to access** | "Download my data" — machine-readable export of profile, orders, addresses |
| **Right to correction** | Self-serve edit + support-assisted correction with audit |
| **Right to erasure** | Account deletion flow that erases or irreversibly anonymises, **while retaining what tax/audit law requires** — this tension must be designed explicitly, not discovered later |
| **Grievance redressal** | Named grievance officer, published contact, ticketing with SLA tracking |
| **Breach notification** | Runbook with the statutory reporting path and timeline; incident classification (§6.5) |
| **Processor agreements** | DPAs with every processor: gateway, BSP, SMS, 3PL, analytics, cloud |
| **Retention schedule** | Per data class — orders retained per tax law; marketing consent expires; rider location purged; support transcripts time-boxed |
| **Children's data** | Age declaration; no behavioural targeting of minors |

## 3.7 Tax, invoicing and marketplace compliance *(absent from v1.0)*

> These are statutory obligations deeply entangled with pricing, invoicing and payouts. Retrofitting is expensive. **Have this section reviewed by a chartered accountant and by counsel before build** — do not implement from first principles.

### 3.7.1 GST

- **HSN code and GST rate on every master product.** Grocery slabs genuinely differ (unbranded staples vs branded packaged vs processed foods). This is a **catalog schema requirement** (§2.4.1), not a checkout-time lookup.
- Decide and document **tax-inclusive vs tax-exclusive** display pricing (Indian retail convention is inclusive).
- **One tax invoice per vendor per order, issued under the vendor's GSTIN** — not the marketplace's. This is a direct consequence of D2/D4 and a reason multi-vendor carts are expensive.
- Invoice generated **after weighing** for variable-weight orders (§1.7.1).
- Credit notes on refunds, cancellations and substitution price deltas.
- Vendors under composition scheme or exemption need a distinct invoice treatment — capture the declaration at onboarding.

### 3.7.2 TCS and TDS

- **TCS under GST §52** and **TDS under Income-tax §194-O** both apply to e-commerce operators collecting payment on behalf of sellers.
- **Rates have changed in recent years. Do not hardcode them.** Store as effective-dated configuration; confirm current rates with your CA.
- Requires: per-vendor deduction ledger, monthly filings, and vendor-visible deduction statements. All three post to the ledger (§2.4.4).

### 3.7.3 Other statutory requirements

| Requirement | Impact |
|---|---|
| **Legal Metrology (Packaged Commodities) Rules** | For pre-packaged goods, listings must display net quantity, MRP, manufacturer/packer, country of origin, consumer-care contact. → `master_product` fields (§2.4.1); admin governance must enforce completeness before a product goes live |
| **FSSAI** | Vendor licence captured at KYC, format-validated, expiry-tracked with renewal reminders, displayed on the store page. Expired licence → auto-suspend listing |
| **Consumer Protection (E-Commerce) Rules** | Named grievance officer with published contact, acknowledgement and resolution SLAs, clear cancellation/refund policy, seller details displayed on every listing |
| **Food recall** | The §1.7.3 recall workflow is a regulatory capability, not a nice-to-have |

## 3.8 Backoffice access control

- Role-based menus and actions; least privilege by default.
- **Dual approval** for: payouts above threshold, refunds above threshold, vendor suspension, commission-rate changes, ledger adjustments. (Carried forward from v1.0 — the right instinct.)
- **Immutable audit log** for every change to financial, catalog-governance or compliance-critical data: who, what, before, after, when, from where.
- Support refund limits by role, with escalation above.
- Quarterly access review; automatic revocation on role change.

## 3.9 Incident response

Severity classes, on-call rotation, communication templates (customer, vendor, regulator), and post-incident review are specified in the Ops Playbook (§6.5).

---

# 4. Frontend Specification

## 4.1 Platform, localisation and performance

**Platform decision:** **PWA-first** for customer, vendor and rider. Rationale — install-free reach (critical for vendor adoption), instant updates, one codebase, small download on constrained devices. A native shell is added when push reliability or performance demands it, not before.

**Device and network baseline** — design and test against the real user, not the developer's phone:
- Target device: mid-range Android, 4 GB RAM.
- Target network: 4G with intermittent 3G fallback.
- Initial JS ≤ 200 KB gzipped; route-level code splitting; images in AVIF/WebP with responsive sizes and lazy loading.
- **Offline tolerance**: cart persists locally; add-to-cart is optimistic with a retry queue; a clear offline banner rather than silent failure.

**Localisation** *(absent from v1.0)*:
- English + Hindi + the launch city's regional language at V1.
- **Product names must be translatable**, not just UI chrome — `master_product.name_i18n`. This is the part teams forget, and it is the part that matters in grocery.
- Locale-correct number, currency and date formatting; Indian digit grouping (₹1,23,456).
- Language switcher in the header; persisted per user.

**Design principles:** mobile-first, high-contrast, spacious, minimal chrome, bottom navigation, thumb-reachable primary actions, and honest empty/loading/error states everywhere.

## 4.2 Customer app

| Screen | Specification |
|---|---|
| **Home** | Search bar pinned top. **"Your usual basket"** (predicted basket, one-tap add — the §0.3 wedge) and **"Buy Again"** above the fold, before categories or banners. Then categories, offers, recommended. Serviceability and current slot shown in the header |
| **Search** | Instant suggestions, recent searches, typo tolerance, regional-term matching, filters (price, brand, veg/non-veg, availability), sort. Zero-result state offers correction, category fallback, and "notify me" |
| **Listing** | Card: image, brand, name, **net quantity + UoM**, MRP struck through, selling price, savings %, **per-unit price (₹/kg)**, veg mark, stock state, variable-weight badge, unit-aware quantity stepper |
| **PDP** | Gallery, description, **Legal Metrology declarations** (net qty, MRP, packer, origin, consumer-care), nutrition where available, variants, seller name and rating, delivery slot preview, substitution note, similar items |
| **Cart** | Line items with unit-aware steppers, savings total, **MOV and free-delivery progress bar**, variable-weight estimate notice, **substitution preference selector**, add-on suggestions, clear total |
| **Checkout** | Single screen, progressive: address → slot (capacity-aware, full slots greyed) → substitution preference → payment → review. Full cost breakdown with taxes; nothing hidden until the last step |
| **Order tracking** | Canonical status timeline with role-appropriate labels, **live substitution prompt with accept/reject**, actual-weight adjustment notice, rider contact when dispatched, invoice download, reorder |
| **Refunds** | Status tracker with expected date and method; no "contact support to find out" |
| **Account** | Addresses, language, notification preferences, **consent management, data download, account deletion** (§3.6), order history, store credit |

## 4.3 Vendor experience

**Primary surface: WhatsApp** (§1.9.3). Every core action — accept, reject, mark OOS, propose substitution, confirm packed, confirm handover — is a template with quick-reply buttons.

**Secondary surface: vendor PWA**
- **Today view**: pending orders (sorted by SLA urgency), sales so far, low-stock digest, slot fill.
- **Order queue**: filter by status, picking list optimised by aisle/category, **actual-weight entry for variable-weight lines**, one-tap OOS with substitute suggestions, batch confirm.
- **Catalog**: search master catalog, barcode scan to add, inline price and stock edit, bulk price update, request-new-product.
- **Inventory**: mode selector (toggle/threshold/quantity), low-stock list, expiry-approaching list.
- **Slots**: capacity per slot, cutoffs, temporary close, holidays.
- **Money**: statement (orders, commission, TCS/TDS, adjustments, payout), downloadable, tied to ledger.
- Designed for **one-hand phone use in a shop** — large tap targets, works on a cracked mid-range screen, tolerant of poor connectivity.

## 4.4 Rider experience *(new in v2)*

Lightweight PWA plus WhatsApp:
- Assigned orders, pickup and drop, navigation deep-link.
- **COD amount to collect** shown prominently (final post-weighing figure), with collected confirmation.
- Delivery OTP entry / contactless photo POD.
- Failed-delivery reasons and RTO initiation.
- **End-of-day cash summary** and deposit reference entry (feeds §2.11.3).
- Earnings view.

## 4.5 Admin dashboard

- **Health strip**: GMV, orders, AOV, active vendors, on-time %, payment success %, contribution margin.
- **Live order board** with exception filters: unaccepted past SLA, substitution stalled, delivery late, payment stuck, reconciliation exception. This is the ops team's home screen.
- **Queues**: vendor approvals, product requests, COD risk, disputes, refund approvals, recall actions.
- **Catalog governance**: master product CRUD, merge duplicates, category and attribute management, HSN/GST rates, **synonym dictionary editor**.
- **Config without deploy**: serviceability polygons, slot templates, COD thresholds, fees, commission rates, feature flags.
- **Finance**: ledger explorer, settlement runs, reconciliation exceptions, statutory reports.

## 4.6 Accessibility

WCAG 2.1 AA across **all four surfaces** — v1.0 specified it for the customer app only, but vendor staff and ops use these tools for eight hours a day.

- Contrast ≥ 4.5:1 body, ≥ 3:1 large text and UI components.
- Full keyboard navigation with visible focus; logical tab order; skip links.
- Semantic HTML with correct roles and labels; screen-reader tested on TalkBack and NVDA.
- Touch targets ≥ 44×44 px.
- Status changes announced via live regions (order status, substitution prompt).
- Never colour alone to convey meaning (stock state, veg mark, order status all need icon or text).
- Automated axe checks in CI **plus** a manual audit before each phase gate in §1.11.

---

# 5. Data & Analytics *(v1.0 deferred this; it is V1)*

> Untracked launch weeks are permanently lost data. The funnel cannot be retrofitted.

## 5.1 Event schema

Canonical events, versioned in `contracts/events/analytics/`. Every event carries: `event_id`, `user_id`/`anon_id`, `session_id`, `timestamp`, `platform`, `app_version`, `city`, `experiment_variants`.

**Discovery** — `app_opened`, `search_performed` (query, results_count, zero_result), `search_result_clicked` (position), `category_viewed`, `product_viewed` (source)

**Basket** — `add_to_cart` (source: search / buy_again / usual_basket / pdp — this attribution is how §0.3's wedge is measured), `remove_from_cart`, `cart_viewed`, `usual_basket_shown`, `usual_basket_accepted`

**Checkout** — `checkout_started`, `address_selected`, `slot_selected` (slot_available_count), `substitution_preference_set`, `payment_method_selected`, `payment_initiated`, `payment_failed` (reason), `payment_succeeded`, `order_placed`

**Fulfilment** — `vendor_accepted` (latency), `line_marked_oos`, `substitution_proposed`, `substitution_accepted` / `_rejected`, `weight_recorded` (variance), `order_packed`, `order_dispatched`, `order_delivered` (on_time), `delivery_failed` (reason)

**Post-order** — `order_cancelled` (by, reason), `refund_initiated` / `_completed`, `reorder_clicked`, `rating_submitted`, `support_ticket_created`

## 5.2 Funnels tied to §1.3.3

1. **Acquisition → first order**: install → signup → serviceability check → first search → first ATC → first order (measures TTFP).
2. **Session → order**: home → search/browse → ATC → checkout start → payment → placed (drop-off at each step).
3. **Repeat**: order N → order N+1, segmented by whether Buy Again / usual-basket was used — the direct measurement of the §0.3 hypothesis.
4. **Fulfilment health**: placed → accepted → packed → delivered, with OOS and substitution branch rates.
5. **Vendor health**: approved → catalog live → first order → 30-day active.

## 5.3 Pipeline

Events → app SDK → ingestion endpoint → outbox → warehouse (BigQuery/Redshift/ClickHouse) → dbt models → BI dashboards. Operational metrics stay in the metrics stack (§2.16); analytics is a separate read path so reporting never contends with the order path.

**Governance:** no PII in event properties (IDs only, resolved in the warehouse); event schema changes are reviewed and versioned; every new frontend ticket must declare its events.

## 5.4 Experimentation

Feature-flag-based assignment with sticky bucketing, guardrail metrics (order completion, payment success, error rate) auto-monitored per experiment, and a minimum-runtime rule so grocery's weekly cycle isn't misread.

---

# 6. Ops Playbook *(v1.0 deferred this; it is V1)*

## 6.1 Daily operating rhythm

| Time | Activity |
|---|---|
| 07:00 | Slot capacity check; vendor availability sweep; open-slot alerts |
| Hourly (peak) | Live order board: unaccepted, stalled substitutions, late deliveries |
| 14:00 | Vendor SLA breach review; catalog request queue |
| 21:00 | Day close: order exceptions, failed deliveries, RTO initiation |
| 22:00 | **Rider cash deposit check** — shortfalls flagged |
| Daily 09:00 | Reconciliation exceptions from previous day (§2.11.3) |
| Weekly | Vendor scorecards; failed-search review → synonym updates; refund-abuse review |
| Monthly | Settlement audit; statutory filings; access review; cost per 1,000 orders |

## 6.2 Order exception handling

| Exception | First response | Escalation |
|---|---|---|
| Vendor not accepting | Auto-reminder at 5 min | Auto-cancel + reassign at SLA; ops call if repeat |
| All items OOS | Auto-cancel, full refund, apology credit | Vendor quality review |
| Substitution unanswered | Apply saved preference | — |
| Rider unavailable | 3PL fallback dispatch | Ops manual assignment |
| Delivery failed | One retry attempt | RTO; refund per §1.8 |
| Weight far outside tolerance | Customer consent prompt | Ops review; vendor flagged |
| Payment stuck | Auto-verify against gateway; retry recovery flow | Manual reconciliation |

## 6.3 COD and payment fraud response

- Daily: COD risk-queue review, RTO rate by pincode, blocked-account queue.
- Rising RTO in a pincode → tighten thresholds for that pincode (config, no deploy).
- Suspected rider cash fraud → immediate assignment freeze, cash audit, HR/legal escalation.
- Suspected vendor self-ordering → payout hold, order-ring analysis, contract action.
- All fraud actions require a reason code and are audit-logged.

## 6.4 Vendor quality management

Vendor score (published to the vendor, drives §2.7.3 ranking):

| Input | Weight |
|---|---|
| Acceptance rate within SLA | 25% |
| OOS rate at picking | 25% |
| On-time handover | 15% |
| Order accuracy / low complaint rate | 15% |
| Customer rating | 10% |
| Catalog completeness & freshness | 10% |

Interventions: coaching call → ranking reduction → slot capacity reduction → suspension. Every step needs a reason code and a documented path back.

## 6.5 Incident response

| Sev | Definition | Response | Comms |
|---|---|---|---|
| **S1** | Ordering or payment down; data breach suspected | Page on-call immediately; incident commander named | Customer status message ≤ 30 min; vendor WhatsApp; **regulator per §3.6 if personal data involved** |
| **S2** | Major degradation (search down, WhatsApp down, one gateway failing) | On-call within 15 min | In-app banner; vendor notice |
| **S3** | Partial/localised (one city, one vendor integration) | Next business hour | Affected users only |
| **S4** | Cosmetic / low impact | Backlog | None |

Every S1/S2 gets a blameless post-incident review within 5 working days with named action items and owners.

## 6.6 Support

- Channels: in-app tickets, WhatsApp, phone (peak hours). Vendors get a dedicated line.
- First-response SLA: 30 min in hours, 4 h out of hours. Resolution: 24 h standard, 4 h for order-in-progress issues.
- Refund authority by role, escalating above limits (§3.8).
- **Published grievance officer** with statutory acknowledgement and resolution SLAs (§3.7.3).

---

# 7. Feature Backlog

## 7.0 What "MVP" means in this document

> **MVP = the smallest set of capabilities that lets one real customer place one real order from one real kirana, pay real money, receive real food, and have the vendor legally and correctly paid.**

It is the output of build Phases 0–6 (§7.4), and the entry condition for P0 Alpha (§1.11).

This MVP is larger than the word usually implies — 17 epics including a double-entry ledger, GST invoicing and delivery. That is deliberate. The floor here is not set by feature ambition but by four things that cannot be done halfway:

| Constraint | What it forces into scope |
|---|---|
| **It is regulated** | The first completed order requires a compliant invoice under the vendor's GSTIN. There is no half a GST invoice |
| **It handles other people's money** | COD cash reaches a rider on day one. Without §2.11 reconciliation, money starts going missing in week one and you will not know how much |
| **It is food, and stock is unreliable** | An item goes out of stock around order #4. Without substitutions (§1.7.2) that is a cancellation and a churned customer |
| **Kirana range is loose goods** | Selling tomatoes by weight makes variable-weight capture (§1.7.1) mandatory, or the charge is simply wrong |

**Terminology note.** By the classical definition — the smallest thing that tests the riskiest hypothesis — this is not an MVP; "V1" or "launch scope" is the more honest label. The riskiest hypothesis in this product is **R-1** (§8.2), and testing it requires no software at all: it is a two-day, ten-store field validation (see the Pre-Build Readiness Checklist, §F). Run that before committing to the build.

**Three scope vocabularies are used in this document and they are distinct:**

| Scheme | Where | Answers |
|---|---|---|
| MVP / Fast-follow / Later | §7.1, §7.3 | *What* gets built |
| Phase 0–7 | §7.4 | *When* engineering builds it |
| P0 / P1 / P2 / P3 | §1.11 | *Business* rollout stage, gated on metrics |

They meet at one point: **Phases 0–6 produce the MVP; Phase 7 is P0 Alpha.**

## 7.1 Epics

| Epic | Title | Phase |
|---|---|---|
| EPIC-001 | Identity, Accounts & Consent | MVP |
| EPIC-002 | Master Catalog & Vendor Offers | MVP |
| EPIC-003 | Search & Discovery | MVP |
| EPIC-004 | Serviceability & Slots | MVP |
| EPIC-005 | Cart & Checkout | MVP |
| EPIC-006 | Inventory & Reservations | MVP |
| EPIC-007 | Orders, State Machine & Substitutions | MVP |
| EPIC-008 | Payments, UPI & COD | MVP |
| EPIC-009 | **Delivery & Fulfilment** *(new)* | MVP |
| EPIC-010 | **Tax, Invoicing & Compliance** *(new)* | MVP |
| EPIC-011 | **Ledger, Settlement & COD Cash** *(new)* | MVP |
| EPIC-012 | **Refunds, Returns & Disputes** *(new)* | MVP |
| EPIC-013 | Vendor Onboarding & WhatsApp Ops | MVP |
| EPIC-014 | Admin & Ops Console | MVP |
| EPIC-015 | **Analytics & Events** *(new)* | MVP |
| EPIC-016 | Notifications (WhatsApp/DLT/Push) | MVP |
| EPIC-017 | Observability, Testing & Release | MVP |
| EPIC-018 | Repeat-Basket Intelligence — **heuristic in MVP** (§2.17.1), ML later | MVP / Later |

## 7.2 Worked exemplar tickets

v1.0 said tickets "should include description, acceptance criteria and dependencies" but showed none. These three are the template.

---

**T-062 — Reserve inventory at checkout initiation** · EPIC-006 · **8 pts** · MVP

*Description.* When a customer initiates checkout, reserve stock for every line whose vendor offer is in `quantity` inventory mode, so concurrent checkouts cannot oversell. Reservations expire on a TTL and release automatically.

*Acceptance criteria*
- **Given** an offer with `stock_on_hand = 1, stock_reserved = 0` **when** two customers initiate checkout simultaneously **then** exactly one reservation is created and the other receives a clear out-of-stock response with substitution options.
- **Given** a reservation exists **when** payment succeeds **then** it moves to `CONFIRMED` and `stock_reserved` is unchanged.
- **Given** a reservation exists **when** payment fails or the TTL (10 min prepaid / 15 min COD) elapses **then** it moves to `RELEASED`, `stock_reserved` decrements, and `reservation.expired` is emitted.
- **Given** an offer in `toggle` or `threshold` mode **when** checkout initiates **then** no reservation is created and the order proceeds.
- **Given** the same `Idempotency-Key` **when** reserve is called twice **then** stock decrements exactly once.
- Optimistic-lock contention retries up to 3× with jittered backoff before failing.
- p95 latency of the reserve call ≤ 150 ms at 150 RPS.

*Dependencies.* T-020 (vendor_offer schema), T-055 (checkout orchestration)
*Test notes.* Concurrency test with 50 parallel checkouts on `stock_on_hand = 5` must yield exactly 5 reservations. Sweeper lag test under 10K open reservations.
*Analytics.* `checkout_started`, `reservation_failed(reason)`
*Risks.* Hot-SKU contention during peak — monitor and switch specific offers to pessimistic locking.

---

**T-084 — Variable-weight capture and adjustment** · EPIC-007 · **13 pts** · MVP

*Description.* Support loose goods sold by weight: authorise an upper bound at checkout, record actual weight at picking, capture the actual amount, and adjust the COD collectable and invoice accordingly.

*Acceptance criteria*
- **Given** a cart containing a variable-weight line **when** the customer reaches checkout **then** the estimate and the tolerance band ("final price may vary ±10%") are displayed before payment.
- **Given** a prepaid order **when** checkout completes **then** the gateway is authorised for `estimate × 1.10`.
- **Given** a picker records 0.94 kg against 1.00 kg ordered **when** the order is packed **then** the line total, order total, and tax recompute to the actual, and the gateway captures the actual amount.
- **Given** the gateway cannot capture below authorisation **when** the order is packed **then** the estimate is captured and the delta is auto-refunded, except where the delta is < ₹5 (absorbed by platform).
- **Given** a COD order **when** it is packed **then** `cod_amount_collectable` is recomputed, rounded to ₹1, pushed to the rider, and messaged to the customer before dispatch.
- **Given** actual weight falls outside tolerance **when** packing **then** customer consent is requested via the substitution prompt before proceeding.
- **Given** any variable-weight order **when** the invoice is generated **then** it reflects actual, never estimated, amounts.

*Dependencies.* T-062, T-070 (order lines), T-090 (payment auth/capture), T-110 (invoice generation)
*Test notes.* Cover under-tolerance, over-tolerance, exact, zero-weight (item unavailable → substitution path), and gateway-capture-unsupported fallback.
*Analytics.* `weight_recorded(variance_pct)`, `weight_consent_requested`, `refund_initiated(reason: weight_adjustment)`
*Risks.* Gateway capability is a hard dependency — verify before contracting (§2.10.2).

---

**T-141 — COD cash reconciliation loop** · EPIC-011 · **13 pts** · MVP

*Description.* Track COD cash from rider collection through bank deposit, posting balanced ledger entries at each step and surfacing shortfalls automatically.

*Acceptance criteria*
- **Given** a COD order is delivered and cash collected **when** the rider confirms **then** `Dr cod_cash_in_transit(rider)` / `Cr vendor_payable + platform_revenue` posts for the exact collected amount.
- **Given** a rider records a deposit with reference **when** the matching bank credit is imported **then** `Dr bank / Cr cod_cash_in_transit(rider)` posts and the deposit is marked reconciled.
- **Given** `cod_cash_in_transit(rider) > 0` past the deposit deadline **when** the daily job runs **then** a shortfall record is created with the exact amount and an ops alert raised.
- **Given** any collection, deposit or adjustment **when** posted **then** total debits equal total credits (invariant asserted in test and in a nightly integrity job).
- **Given** a reconciled COD order **when** the T+7 settlement runs **then** the vendor payout is computed from the ledger balance, net of commission, TCS and TDS.
- Vendor statement ties to the ledger to the rupee.

*Dependencies.* T-130 (ledger core), T-100 (delivery POD + cash confirm), T-135 (bank statement import)
*Test notes.* Partial deposit, over-deposit, deposit against wrong reference, rider with multiple open days, cancelled-after-collection.
*Analytics.* `cod_collected`, `cod_deposited`, `cod_shortfall_raised`
*Risks.* Bank statement import format varies by bank — build the parser behind an adapter.

---

## 7.3 MVP cut-line

| ✅ In MVP | ⏩ Fast-follow | ⏸ Later |
|---|---|---|
| OTP login, addresses, **consent & data rights** | Cards, wallets | Social login, guest checkout |
| **Master catalog + vendor offers** | Vendor bulk upload | Vendor POS integration |
| Search + **synonyms/transliteration** | Voice search | Personalised ranking, ML relevance |
| **Serviceability + slot capacity** | Slot surge pricing | Dynamic slot pricing |
| **Single-vendor cart**, slot checkout | — | Multi-vendor cart |
| **Substitutions** (§1.7.2) | Substitution learning | — |
| **Variable weight** (§1.7.1) | — | — |
| **Reservations** (§2.5) | — | — |
| UPI + COD with risk bands | Fraud ML scoring | BNPL, EMI |
| Canonical state machine + tracking | Live map tracking | Predictive ETA |
| **Delivery: vendor self + 3PL fallback** | **Order batching** | Own fleet + rider app |
| **GST invoicing, TCS/TDS ledger** | E-invoicing at threshold | — |
| **Double-entry ledger, settlements, COD cash** | Automated dispute resolution | — |
| **Refunds + partial refunds** | Returns workflow | Store-credit wallet top-up |
| Buy Again + **"Your usual basket"** (heuristic — §2.17.1) | Substitution learning signals | Predictive basket (ML), via §2.17 |
| Vendor WhatsApp ops + PWA dashboard | Vendor analytics | Vendor ads/promotions |
| Admin: vendors, orders, COD, catalog, config | Full BI suite | Automated vendor scoring |
| **Analytics events + funnels** | Experimentation platform | — |
| Order-level rating | Product reviews | Photo reviews |
| **Recall workflow** | — | — |

Note the shape of this trade: substitutions, variable weight, GST invoicing, the ledger and delivery — all absent or deferred in v1.0 — are **in MVP**, while social login, voice search, reviews and multi-vendor cart move **out**. That trade is the core of the v2 rewrite.

## 7.4 Sequencing

| Phase | Weeks | Focus |
|---|---|---|
| **0 — Foundations** | 1–3 | Repo, module skeleton + boundary CI checks, auth, DB, CI/CD, observability baseline |
| **1 — Catalog & discovery** | 3–7 | Master catalog, vendor offers, search + synonyms, serviceability |
| **2 — Order core** | 6–12 | Cart, slots, reservations, checkout, state machine, substitutions, variable weight |
| **3 — Money** | 10–16 | Payments, COD risk + confirmation, ledger, tax/invoicing, refunds |
| **4 — Fulfilment** | 13–18 | Delivery abstraction, assignment, POD, RTO, 3PL adapter |
| **5 — Vendor & admin** | 8–18 (parallel) | WhatsApp ops, vendor PWA, admin console, ops queues |
| **6 — Settlement & hardening** | 16–22 | Settlement runs, reconciliation loops, load tests, chaos drills, a11y audit |
| **7 — Alpha (P0)** | 22–26 | 5 vendors, 1 pincode, real money, real cash |

Phases overlap; §1.11 gates govern promotion, not the calendar.

---

# 8. Open Decisions & Risks

## 8.1 Decisions still to be made

| # | Decision | Owner | Needed by | Notes |
|---|---|---|---|---|
| ~~OD-1~~ | ~~Backend language~~ — **CLOSED 2026-08-12: TypeScript / NestJS** | — | — | AI/ML built later as an attached Python service (§2.17). Node 22 LTS, Drizzle, shared `contracts` package across API + 4 frontends |
| OD-2 | Payment gateway | Founder + Eng | Phase 0 | Must satisfy all six §2.10.2 criteria — auth/capture with downward adjustment is the binding one |
| OD-3 | WhatsApp BSP | Ops | Phase 0 | Template approval lead time is on the critical path |
| OD-4 | 3PL aggregator partner | Ops | Phase 4 | Coverage in the launch pincode is the deciding factor |
| OD-5 | Cloud provider & region | Eng lead | Phase 0 | Data-residency posture should inform this (§3.6) |
| OD-6 | Launch city and pincode cluster | Founder | Phase 0 | Determines regional-language and synonym seeding |
| OD-7 | Commission rates by category | Founder + Finance | Phase 3 | §1.3.2 model needs validation against real vendor willingness |
| OD-8 | Store-credit legal structure | Counsel | Phase 3 | RBI prepaid-instrument implications (§1.8.2) |
| OD-9 | Current TCS/TDS rates and filing cadence | CA | Phase 3 | Do not implement from memory (§3.7.2) |
| OD-10 | Vendor agreement: RTO, chargeback and shrinkage liability | Counsel | Phase 3 | Determines ledger allocation rules |
| OD-11 | AI provider(s) — **deferred, routing pre-decided** | Eng lead | When a §2.17.3 trigger fires | DeepSeek for PII-free workloads; a DPA/residency-cleared provider for anything customer-facing (§2.17.5). Speech-to-text is a separate vendor from the LLM |

## 8.2 Top risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| **R-1** | **Kirana stores cannot maintain accurate inventory** | Breaks OOS targets, slot promises, customer trust | §1.9's tiered inventory modes and substitution-first design. **Validate with 10 real stores before further build** — if false, the product must be redesigned around uncertain inventory, not patched |
| R-2 | Vendor churn after onboarding | No supply, no marketplace | WhatsApp-first ops (§1.9.3), assisted onboarding, fast payouts, vendor-visible statements |
| R-3 | Unit economics don't close | Unsustainable | AOV growth via repeat-basket (§0.3), delivery batching (§2.9.2), MOV enforcement. §1.11 P1 gate is the honest checkpoint |
| R-4 | COD RTO higher than modelled | Direct cash loss | Risk bands (§2.10.4), pincode-level tightening, prepaid incentives |
| R-5 | Quick commerce enters the planned-shop segment | Competitive squeeze | Range and price advantage of real kirana catalogs; vendor relationships as the moat |
| R-6 | Compliance gap found late | Legal exposure, launch delay | §3.7 reviewed by CA and counsel **in Phase 3, not Phase 7** |
| R-7 | Gateway lacks variable-weight capture | Blocks a core grocery flow | Hard selection criterion in OD-2; refund-delta fallback designed in (§1.7.1) |
| R-8 | Team over-builds anyway | Slow shipping | Extraction triggers (§2.1.2) are published and reviewed at each phase gate |

---

# References

## Evidence — used to support specific claims

1. Baymard Institute — *Grocery and Food Delivery Site UX: Allow Users to Add Past Purchases to the Cart from the Homepage.* https://baymard.com/blog/grocery-food-delivery-orders — basis for §0.3, §4.2 home-screen priority
2. Ariannezhad et al. — *ReCANet: A Repeat Consumption-Aware Neural Network for Next Basket Recommendation in Grocery Shopping.* https://staff.fnwi.uva.nl/m.derijke/wp-content/papercite-data/pdf/ariannezhad-2022-recanet.pdf — basis for §0.3 repeat-basket thesis and EPIC-018
3. Ipsos — *Consumer pain points and priorities in grocery ecommerce.* https://www.ipsos.com/en-us/ipsos-report-explores-consumer-pain-points-and-priorities-grocery-ecommerce
4. Google Cloud — *Build a microservice-based ecommerce web application.* https://developers.google.com/learn/pathways/solution-ecommerce-microservices-kubernetes — consulted; §2.1 deliberately diverges on scale grounds
5. W3C — *Web Content Accessibility Guidelines 2.1.* https://www.w3.org/TR/WCAG21/ — basis for §4.6

## Primary sources — to be consulted directly before implementing §3

These replace the secondary blog sources in v1.0. **Verify current text and rates directly; do not rely on summaries, including this one.**

6. NPCI — UPI circulars and product guidelines. https://www.npci.org.in/what-we-do/upi/circular
7. RBI — Card-on-file tokenisation directions; prepaid payment instrument (PPI) directions (relevant to §1.8.2 store credit). https://www.rbi.org.in
8. CBIC / GST portal — Section 52 TCS for e-commerce operators; invoicing rules; HSN and rate schedules. https://www.cbic.gov.in · https://www.gst.gov.in
9. Income Tax Department — Section 194-O TDS on e-commerce transactions. https://www.incometax.gov.in
10. MeitY — Digital Personal Data Protection Act, 2023 and rules. https://www.meity.gov.in
11. FSSAI — Licensing and registration; e-commerce food business obligations. https://www.fssai.gov.in
12. Department of Consumer Affairs — Legal Metrology (Packaged Commodities) Rules; Consumer Protection (E-Commerce) Rules. https://consumeraffairs.nic.in
13. TRAI — TCCCPR / DLT registration for commercial communications. https://www.trai.gov.in
14. Meta — WhatsApp Business Platform documentation. https://developers.facebook.com/docs/whatsapp

## Visual inspiration — not evidence

Dashboard layout references consulted for §4.3–§4.5 visual direction only; no design claim in this document rests on them.

15. Dribbble — grocery and marketplace dashboard collections. https://dribbble.com/tags/grocery-dashboard
16. Mercur — *Key admin features in a B2B food marketplace.* https://mercurjs.com/guides/b2b-food-marketplace/key-admin-features-in-b2b-food-marketplace

---

*End of document. Companion gap analysis: `FreshKirana – Documentation Review, Gap Analysis & Recommendations.md`. Previous version: `archive/FreshKirana – Documentation Set v1.0 (original).md`.*
