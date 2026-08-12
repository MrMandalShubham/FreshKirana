# FreshKirana – Scalable Grocery Marketplace Documentation Set

## Executive Summary

FreshKirana is a multi-vendor grocery marketplace designed to serve local kirana stores and household customers with fast, reliable online ordering, inventory visibility, and repeat-purchase flows across web and mobile channels. The platform must be architected from day one to scale beyond 100K+ users and thousands of daily orders, requiring solid marketplace requirements, microservice-oriented technical architecture, strong security and access controls, robust frontend UX specifications, and a ticketable feature backlog.[^1][^2][^3][^4]

This documentation set provides five core artifacts: a Product Requirements Document (PRD), Technical Architecture Document, Security & Access Document, Frontend Specification, and Feature Ticket List, all tailored to a grocery marketplace with Indian payments and COD realities. The goal is to give engineering, product, and operations teams a shared blueprint for building and scaling FreshKirana safely.[^1][^5][^6]

***

## 1. Product Requirements Document (PRD)

### 1.1 Product Overview

FreshKirana is a B2C multi-vendor grocery platform where local stores onboard, maintain SKU-level catalogs, and fulfill orders from nearby customers through delivery or pickup options. Customers browse products via search and categories, manage carts, choose delivery slots, pay via UPI/cards/COD, and can easily reorder past baskets.[^7][^8][^9][^1]

Key characteristics:
- Multi-vendor marketplace: many independent shops, one unified customer experience.[^2][^7]
- Grocery-specific: unit-based products (kg, g, litre, ml, piece), perishables, substitutions, inventory volatility.[^3][^1]
- India-focused payments and logistics: UPI, cards, wallets, COD, slot-based delivery, and pickup.[^5][^6][^1]

### 1.2 Objectives and Success Metrics

Primary objectives:
- Enable local kirana stores to list products, manage stock, and receive online orders through FreshKirana rather than fragmented WhatsApp/phone flows.[^7][^1]
- Provide customers a fast, low-friction grocery ordering experience optimized for repeat baskets and past purchases.[^8][^10][^1]
- Build a scalable infrastructure that can handle 100K+ registered users, thousands of concurrent sessions, and 100K daily orders without rewrites.[^1][^2][^3]

Indicative success metrics:
- Time to first purchase (TTFP) < 5 minutes for new customers.[^10]
- Repeat purchase rate ≥ 40% after 3 months.[^11][^12]
- Order completion rate ≥ 90% (low failure/cancellation).[^5][^1]
- Inventory error rate (out-of-stock at fulfillment) < 2%.[^1]

### 1.3 User Roles and High-Level Needs

Primary roles:

- Customer (household buyer): Wants fast search, category navigation, clear units and prices, simple checkout, reliable delivery/pickup, and easy reorder.[^13][^14][^15][^8]
- Vendor/Shop: Needs easy onboarding, SKU-level product management, real-time stock and price updates, order queues, and basic sales analytics.[^16][^7][^1]
- Admin/Operations: Requires global view of vendors, users, orders, payments, COD confirmation queues, disputes, and performance metrics.[^17][^18][^2]

### 1.4 Core Functional Scope (V1)

#### Customer-facing

- Registration and login (OTP and password; optional social login, guest checkout).[^13]
- Location and address management.
- Home: search bar, category shortcuts (Vegetables, Fruits, Rice, Oil, Dairy, Snacks), banners, recommendations, and "Past Purchases" / "Buy Again" carousels.[^9][^8][^13]
- Search: grocery-specific search with auto-suggest, filters (price, availability, brand, delivery time) and voice search later.[^10][^13][^1]
- Product listing pages: product cards with image, unit, price, discount, ratings, stock status, and add-to-cart.[^13]
- Product detail pages: description, nutritional info, variants/units, delivery estimate, reviews, similar products, and substitution preferences in later phases.[^10][^1][^13]
- Cart: quantity controls, savings display, delivery fee, suggested add-ons, substitution preferences (later), and estimated total.[^1][^13][^10]
- Checkout: address selection, slot selection, payment options, final review, and clear cost breakdown.[^13][^1]
- Orders: status tracking (Confirmed, Packed, Out for Delivery, Delivered, Cancelled), real-time ETA, notifications, and one-click reorder of past baskets.[^8][^10][^13]

#### Vendor-facing

- Vendor registration and approval workflow (KYC, GST, bank details, store documents).[^2][^7]
- Store profile: name, address, service area, operating hours, delivery/pickup capabilities.
- Product catalog: create/edit SKUs with title, description, categories, units, pricing, stock levels, images, and tags.[^2][^1]
- Inventory management: bulk updates, low-stock alerts, reservations, and availability per slot.[^2][^1]
- Order management: order queues with statuses (New, Accepted, Packed, Handover, Completed, Cancelled), picking lists, and printing as needed.[^7][^1]
- Basic analytics: daily sales, top products, acceptance rate, prep time, repeat customers.[^19][^16]

#### Admin-facing

- Admin login and role management.
- Vendor management: approvals, suspensions, quality ratings, and performance view.[^17][^2]
- Catalog governance: global categories, attributes, and moderation of product content.[^2]
- Orders overview: cross-vendor order lists, SLA metrics, and exception tracking.
- Payments and commissions: configuration of take rate, vendor payouts, COD/online mix overview.[^20][^2]
- Risk and COD confirmation view: high-value COD orders and UPI failures, integrated with OMS logic and communication channels like WhatsApp/IVR/OTP.[^6][^5]

### 1.5 Non-Functional Requirements

- Scalability: Architect for 100K+ registered users and 100K daily orders; design for microservice scaling rather than monolith growth.[^21][^3][^1][^2]
- Performance: low-latency search and listing pages via caching (Redis) and tuned database queries; target TTFT < 5 seconds under load.[^3][^1]
- Availability: deploy with high availability for core services (auth, catalog, cart, checkout, orders, payments) and multi-AZ DB setup.[^22]
- Security: robust auth, role-based access control, secure handling of payments, fraud controls for UPI and COD, and compliance with local regulations.[^20][^6][^5]
- Observability: logging, metrics, and alerting across services; dashboards for errors, response times, and business KPIs.

***

## 2. Technical Architecture Document

### 2.1 Architectural Style and Rationale

The FreshKirana backend should be built using a domain-driven microservices architecture rather than a monolithic application, to support independent scaling of high-load components like search, cart, and payment logic. Microservices align with best practices for modern e-commerce marketplaces, enabling modular development, fault isolation, and targeted performance tuning.[^4][^20][^3][^2]

Recommended high-level domains:

- Identity & Access: auth, user accounts, roles, tokens.[^20][^2]
- Commerce: catalog, inventory, cart, checkout, orders.[^4][^2]
- Financial: payments, payouts, COD workflows, refunds.[^20][^2]
- Operations: vendor onboarding, admin tools, disputes, compliance.[^2]

### 2.2 Service Decomposition

A practical service breakdown inspired by multi-vendor marketplace architectures:[^4][^2]

- **identity-service**: authentication, JWT and refresh tokens, OAuth/OTP, role management.
- **user-service**: customer profiles, addresses, preferences, and persona data.
- **vendor-service**: vendor accounts, KYC, store configuration.
- **catalog-service**: categories, attributes, SKUs, search index, and metadata.
- **inventory-service**: stock levels, reservations, low-stock alerts.
- **pricing-service**: prices, discounts, offers, and promotions.
- **cart-service**: cart state, item additions/removals, substitution preferences.
- **checkout-service**: orchestration of address, slot, payment, and order creation.
- **order-service**: order lifecycle and status transitions.
- **payment-service**: integration with payment gateways (UPI, cards, wallets), webhooks, authorisation holds, and capture during weight-based adjustments.[^5][^1]
- **payout-service**: vendor settlements and commission logic.[^20][^2]
- **cod-oms-service**: COD confirmation, UPI failure recovery, communication channels (WhatsApp, IVR, SMS), and risk rules.[^6][^5]
- **notification-service**: push, email, SMS, and in-app notifications.
- **analytics-service**: compute and expose KPIs for users, vendors, and admins.

Each service exposes APIs via an API gateway or BFF layer and communicates using synchronous REST/gRPC calls plus asynchronous events over a broker (e.g., Kafka or Redis pub/sub), following event-driven architecture patterns applied in scalable e-commerce.[^21][^20][^2]

### 2.3 Data Storage and Caching

Recommended data strategy:[^22][^3][^2]

- Primary relational DB: PostgreSQL for transactional data (users, orders, payments, payouts) with ACID guarantees and row-level security where needed.[^3][^2]
- NoSQL DB: MongoDB or similar for product catalogs, flexible attributes, and session-like documents.[^22][^3]
- Cache: Redis for catalog caching, sessions, and quick lookups to reduce query time in high-load operations.[^3][^1][^2]
- File storage: object storage (e.g., S3/Spaces) for product images and static assets.[^22][^3]

Design considerations:
- Indexing and query optimization for SKU-level search and filtering.
- Catalog caching and search indexing to avoid DB bottlenecks at scale.[^1][^3]
- Time-based partitioning or archiving of old orders for performance and compliance.

### 2.4 API Gateway / BFF and Client Interfaces

Use an API gateway and/or Backend-for-Frontend (BFF) pattern to simplify communication between frontends and microservices. Expose three main client interfaces:[^21][^22][^20]

- Customer app/web: home, search, listing, product, cart, checkout, orders.
- Vendor web dashboard: inventory, orders, analytics.
- Admin web dashboard: marketplace metrics, controls, risk views.

The BFF aggregates microservice responses, applies front-end specific logic and caching, and avoids direct multi-service calls from the UI.[^20]

### 2.5 Scalability and Deployment

Following scalable e-commerce guidance, FreshKirana should run on containers orchestrated by Kubernetes or a similar platform, with horizontal scaling and load balancing. Key elements:[^21][^22][^3]

- Containerised microservices (Docker) orchestrated via Kubernetes or ECS/Fargate.[^22][^3][^21]
- Multiple clusters or regions for geographic scaling and failover if needed.[^21]
- API gateway and load balancer for traffic distribution, SSL termination, and routing.[^22][^21]
- CI/CD with automated testing and blue-green or rolling deployments.[^22]

Design target capacities based on multi-vendor marketplace examples:[^2]

- Concurrent users: 10,000+.
- Daily orders: 100,000+.
- Products per vendor: tens of thousands.

### 2.6 Observability and Operations

Implement full observability:
- Centralized logging across services.
- Metrics (latency, throughput, error rates) and dashboards.
- Tracing across service calls.
- Alerts for error spikes, latency thresholds, and business anomalies.

***

## 3. Security and Access Document

### 3.1 Authentication

Use secure, modern auth patterns:
- Email/phone-based login with OTP, optionally combined with password.[^13][^20]
- JWT access tokens with short lifetimes and refresh tokens stored in HttpOnly cookies; leverage OAuth2/OIDC via identity provider like Keycloak for multi-tenant or advanced needs.[^20][^2]
- Guest checkout support with limited capabilities but clear upgrade path.[^10][^13]

### 3.2 Authorization and Role-Based Access Control (RBAC)

Define clear roles:
- Customer.
- Vendor owner.
- Vendor staff.
- Admin.
- Support/ops.

Each role should have a well-defined permission set across services, and apply service-level RBAC combined with resource-level checks (e.g., vendor staff may only access their own store’s inventory and orders).[^20][^2]

### 3.3 Data Protection and Privacy

Principles:
- Store only necessary PII (names, phone, addresses) with encryption at rest where appropriate.
- Never store full card details; rely on tokenization from payment gateways.
- Protect UPI and COD-related transaction data following guidelines from Indian payment security recommendations.[^6][^5]
- Implement transport security (HTTPS/TLS) for all APIs.

### 3.4 Payment and COD Security

UPI + card security:
- Use official PSPs and gateways; validate callbacks and signatures.[^5][^6]
- Implement velocity checks and fraud rules (e.g., high frequency orders, high-value thresholds).[^6][^5]

COD confirmation:
- Multi-channel confirmation (WhatsApp, IVR, OTP) for higher-risk COD orders.[^5]
- Rules for when COD requires extra checks (e.g., above ₹2,000 or higher-risk PIN codes).[^5]
- Monitoring and audit trails for COD conversions and cancellations.

UPI fraud controls:
- Verification of merchant VPA for QR codes and publishing official VPA to customers as a verification channel.[^6]
- Policies to prevent staff from approving collect requests they did not initiate.[^6]

### 3.5 Access Control for Backoffice

Vendor and admin dashboards:
- Role-based menus and actions.
- Fine-grained permissions for high-risk operations (e.g., payouts, refunds, suspensions) with dual-approval for certain actions.[^2]
- Logging and traceability for changes to financial or compliance-critical data.

### 3.6 Compliance and Regulatory Considerations

- Adhere to local data protection and financial transaction norms.
- Maintain audit logs for orders, payouts, and disputes.
- Build export and reporting capabilities for compliance teams.[^2]

***

## 4. Frontend Specification Document

### 4.1 Platform and Design Principles

FreshKirana’s frontend should be mobile-first, with responsive designs for phones and desktop, and use clean, minimal UI focused on readability and fast navigation. Key principles:[^10][^13]
- Clean, spacious layouts, minimal clutter.[^13]
- High-contrast typography and clear CTAs.[^10][^13]
- Bottom navigation for main customer actions.[^13]
- Performance-minded design (optimized images, caching, minimal blocking resources).[^13]

### 4.2 Customer App Screens and Behaviours

Core screens and UX guidance, based on grocery UX best practices:[^8][^10][^13]

- Home: search bar at top, category shortcuts, offers banners, recommended products, and "Buy Again"/"Past Purchases" prominently visible above the fold.[^9][^8][^10]
- Search: auto-suggestions, filters, voice search extension, and visual cues for results and previous searches.[^10][^13]
- Product listing: image, price, discount, unit, rating, "Add to Cart" button, sorting and filtering options.[^13]
- Product detail: images with zoom, description, nutritional info, delivery ETA, reviews, related products.[^10][^13]
- Cart: quantity controls, savings, delivery fee, add-on suggestions, substitution preferences (later), and clear CTA for checkout.[^10][^13]
- Checkout: minimal steps, auto-fill addresses, slot selection, payment options, and clear total breakdown.[^13][^10]
- Orders: timeline and status steps, map/ETA for delivery tracking, reorder button.

### 4.3 Vendor Dashboard UX

Vendor dashboard UX should be tuned for daily operations:[^23][^24][^19]

- Sidebar navigation: dashboard, products, orders, analytics, offers, settings.
- Overview: sales KPIs, pending orders, low-stock alerts, and store rating.
- Inventory table: products with stock, price, and status tags; inline edit flows.
- Orders view: filter by status, batch operations for confirmations and packing.

### 4.4 Admin Dashboard UX

Admin dashboard UX should show global marketplace health and risk areas:[^25][^18][^26]

- Top bar: GMV, active vendors, orders, take rate.
- Charts: revenue trends, order volume, vendor distribution.
- Lists: approvals, COD queues, disputes.
- Tables: top vendors, customer health metrics, operational activity feed.

### 4.5 Performance and Accessibility

- Optimize images and use caching for product pages.[^10][^13]
- Ensure keyboard navigation and screen reader support.[^10]
- Maintain WCAG AA-level contrast and accessible CTAs.[^10]

***

## 5. Feature Ticket List

### 5.1 Structuring Work as Epics and Tickets

To guide development, break the FreshKirana build into epics and granular tickets that cover development and confirmation/QA tasks. This aligns with agile approaches for complex e-commerce platforms.[^4][^21]

Example epics:
- EPIC-001: Identity & Accounts.
- EPIC-002: Customer Browsing & Search.
- EPIC-003: Cart & Checkout.
- EPIC-004: Orders & Tracking.
- EPIC-005: Vendor Onboarding & Catalog.
- EPIC-006: Inventory & Pricing.
- EPIC-007: Payments & COD.
- EPIC-008: Admin Operations.
- EPIC-009: Observability & Scaling.

### 5.2 Sample Tickets per Epic

Each ticket should include a short description, acceptance criteria, and dependencies.

EPIC-001 Identity & Accounts:
- T-001: Implement OTP-based login and registration (customer).
- T-002: Implement vendor registration form with KYC fields.
- T-003: Set up JWT access and refresh tokens, role-based auth middleware.

EPIC-002 Customer Browsing & Search:
- T-010: Implement home screen with search and categories.
- T-011: Implement grocery-specific search with filters.
- T-012: Implement "Past Purchases" / "Buy Again" carousel on home.[^9][^8]

EPIC-003 Cart & Checkout:
- T-020: Implement cart UI and API with quantity controls.
- T-021: Implement checkout flow (address, slot, payment option).
- T-022: Integrate payment gateway and handle payment statuses.

EPIC-004 Orders & Tracking:
- T-030: Implement order creation and status lifecycle.
- T-031: Implement order tracking UI and notifications.[^13][^10]
- T-032: Implement reorder from past orders.

EPIC-005 Vendor Onboarding & Catalog:
- T-040: Implement vendor dashboard skeleton.
- T-041: Implement product CRUD with attributes and images.
- T-042: Implement KYC review and approval workflow.

EPIC-006 Inventory & Pricing:
- T-050: Implement inventory service and low-stock alerts.
- T-051: Implement pricing rules and discounts.

EPIC-007 Payments & COD:
- T-060: Implement payment service integration with UPI and cards.
- T-061: Implement COD confirmation workflows (WhatsApp/IVR/OTP).[^5]
- T-062: Implement UPI failure recovery logic via smart payment links and conversion to COD for trusted customers.[^5]

EPIC-008 Admin Operations:
- T-070: Implement admin dashboard overview.
- T-071: Implement vendor management UI and APIs.
- T-072: Implement disputes and risk monitoring views.

EPIC-009 Observability & Scaling:
- T-080: Set up centralized logging.
- T-081: Set up metrics and dashboards.
- T-082: Configure scaling rules and load tests for 100K+ user scenario.

***

## Conclusion and Suggestions

FreshKirana’s documentation set defines what the product must achieve and how the system should be structured to handle over 100K users, multi-vendor inventory, Indian payments, and grocery-specific UX needs. The PRD and architecture sections emphasize SKU-level inventory, microservices, event-driven design, and search/cart/payment scalability, all of which are highlighted as central to grocery marketplace success and resilience at higher order volumes.[^3][^4][^1][^2]

Two additional suggestions:
- Add a separate **Data & Analytics Document** later to define tracking, reporting, and AI-enriched features like repeat basket recommendations and predictive lists as the platform matures.[^12][^11][^10]
- Add an **Ops Playbook** describing incident response, COD/UPI fraud handling, and support workflows; this aligns with best practices in Indian e-commerce OMS and payment security guidance.[^6][^5]

This set is intentionally designed as a foundation you can refine with stack-specific details (e.g., exact language/framework choices) as you lock implementation plans.

---

## References

1. [Grocery Delivery Marketplace: Build Guide 2026 | LOW/CODE](https://www.lowcode.agency/blog/how-to-build-a-grocery-delivery-marketplace) - Build a grocery delivery marketplace with real-time inventory, fast checkout, and driver routing. Co...

2. [Multi-Vendor E-Commerce Platform (BACKEND System)](https://www.kdxlabs.cloud/projects/multi-vendor-e-commerce-platform-backend-system) - A scalable multi-vendor marketplace featuring 15 microservices, escrow-based payment protection, ten...

3. [Tech Wisdom: The Perfect Stack for Grocery Apps - developers.dev](https://www.developers.dev/tech-talk/tech-wisdom-the-perfect-stack-for-grocery-apps.html) - Expert guide on choosing the perfect tech stack for grocery apps. Learn about scalable architecture,...

4. [Microservices architecture for eCommerce application ...](https://codewave.com/insights/microservices-architecture-ecommerce/) - Building modern, scalable eCommerce applicatin using microservices architecture and agile methodolog...

5. [How Do Indian E-commerce Brands Handle COD Confirmation and ...](https://base.com/en-IN/blog/how-do-indian-e-commerce-brands-handle-cod-confirmation-and-payment-failures-using-oms/) - Learn how Indian e-commerce brands use OMS to verify customer intent, cod confirmation, and recover ...

6. [UPI Payment Security: Fraud Prevention for Indian Businesses](https://www.bachao.ai/blog/upi-payment-security-fraud-prevention-india) - Protect your business from UPI payment fraud in India. Covers fake QR code attacks, SIM swap, vishin...

7. [Tuulyn Case Study: Multi-Vendor Grocery Marketplace](https://www.nextelligentia.com/case-studies/tuulyn) - Case study: Nextelligentia built Tuulyn, a Malaysian multi-vendor grocery ecommerce marketplace with...

8. [Grocery and Food Delivery Site UX: Allow Users to Add “ ...](https://baymard.com/blog/grocery-food-delivery-orders) - The homepage is key for grocery and food delivery and takeout users — discover from our latest test ...

9. [Grocery and Food Delivery Site UX - Allow Users to Add “ ...](https://www.uxlift.org/articles/grocery-and-food-delivery-site-ux---allow-users-to-add-past-purchases-to-the-cart-from-the-homepage/) - The homepage is key for grocery and food delivery and takeout users — discover from our latest test ...

10. [Frequently Asked Questions](https://www.developers.dev/tech-talk/grocery-app-ux-strategies.html) - CTOs and VPs: Discover world-class grocery app UX strategies to cut cart abandonment, boost AOV by u...

11. [ReCANet: A Repeat Consumption-Aware Neural Network for Next Basket Recommendation in Grocery Shopping](https://staff.fnwi.uva.nl/m.derijke/wp-content/papercite-data/pdf/ariannezhad-2022-recanet.pdf)

12. [What Grocery Brands Teach DTC Stores About Repeat ...](https://www.growthsuite.net/blog/what-grocery-brands-teach-dtc-stores-about-repeat-purchases) - Grocery stores have mastered repeat buying for decades. Learn 6 proven grocery retail tactics Shopif...

13. [Mobile App UI/UX Tips for Grocery Shopping Apps - LinkedIn](https://www.linkedin.com/pulse/mobile-app-uiux-tips-grocery-shopping-apps-mohit-khandelwal-lr92c) - Discover top UI/UX tips for grocery shopping apps to boost user experience, improve navigation, fast...

14. [Ipsos report explores consumer pain points and priorities in grocery ...](https://www.ipsos.com/en-us/ipsos-report-explores-consumer-pain-points-and-priorities-grocery-ecommerce) - Exclusive study ranks the performance of top 17 grocery brands on ecommerce methods and digital tran...

15. [PRESS RELEASE](https://www.ipsos.com/sites/default/files/ct/news/documents/2025-01/Ipsos-grocery-ecommerce-release-2024.pdf)

16. [food vendor dashboard](https://dribbble.com/search/food-vendor-dashboard) - Explore thousands of high-quality food vendor dashboard images on Dribbble. Your resource to get ins...

17. [Key admin features in Food B2B marketplace](https://mercurjs.com/guides/b2b-food-marketplace/key-admin-features-in-food-b2b-marketplace) - Admins play a critical role in managing marketplace operations, ensuring compliance, overseeing vend...

18. [Marketplace Management Dashboard UI UX Design](https://dribbble.com/shots/27087412-Marketplace-Management-Dashboard-UI-UX-Design) - Marketplace Management Dashboard UI UX Design designed by Mahmudul Hasan Manik for Panze - UX Design...

19. [FreshCart - Grocery Dashboard V1 #388529](https://www.templatemonster.com/ui-elements/freshcart-grocery-dashboard-v1-388529.html) - Welcome to FreshCart - Grocery Dashboard V1, your ultimate companion in grocery management. Experien...

20. [Building a Multi-Vendor E-Commerce SaaS Platform with ...](https://www.linkedin.com/posts/akshayjyothip_microservices-ecommerce-saas-activity-7390347745716264960-NG2-) - 🚀 Thrilled to share my latest project: A Multi-Vendor E-Commerce SaaS Platform built entirely on mod...

21. [Build a microservice-based ecommerce web application ...](https://developers.google.com/learn/pathways/solution-ecommerce-microservices-kubernetes) - Learn how to build a distributed, scalable ecommerce web app using microservices on Kubernetes.

22. [How I Designed a Cloud Architecture for a Multi-Vendor E-Commerce MVP @ BIVY TECH](https://medium.com/@dnkwocha14/how-i-designed-a-cloud-architecture-for-a-multi-vendor-e-commerce-mvp-bivy-tech-e8679bab7abe) - Introduction

23. [Grocery Dashboard](https://dribbble.com/tags/grocery-dashboard) - Discover 20 Grocery Dashboard designs on Dribbble. Your resource to discover and connect with design...

24. [grocery dashboard](https://dribbble.com/search/grocery-dashboard) - Explore thousands of high-quality grocery dashboard images on Dribbble. Your resource to get inspire...

25. [marketplace admin dashboard](https://dribbble.com/search/marketplace-admin-dashboard) - Explore thousands of high-quality marketplace admin dashboard images on Dribbble. Your resource to g...

26. [Marketplace Dashboard - UX and UI Kits - Envato](https://elements.envato.com/marketplace-dashboard-XNGKEGR) - Get Marketplace Dashboard that includes marketplace & analytics, from our library of UX and UI Kits....

