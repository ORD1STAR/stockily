<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f766e,100:1d4ed8&height=200&section=header&text=Stockily&fontSize=48&fontColor=fff&animation=fadeIn&fontAlignY=38&desc=Stock%2C%20quality%20and%20invoicing%20for%20Algerian%20wholesalers&descAlignY=58" alt="Stockily banner" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&pause=1000&center=true&vCenter=true&width=700&lines=Modular+multi-tenant+stock%2C+quality+and+invoicing;Nx+monorepo%3A+NestJS+%2B+React+%2B+Prisma+%2B+PostgreSQL;Decree+05-468+invoices%2C+DZD%2C+amount+in+words+in+FR+and+AR;Hexagonal+domain+layer+enforced+by+ESLint" alt="Typing SVG" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/NestJS-11-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Prisma-6-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Nx-23-143055?style=for-the-badge&logo=nx&logoColor=white" alt="Nx" />
  <img src="https://img.shields.io/badge/Socket.IO-4-010101?style=for-the-badge&logo=socketdotio&logoColor=white" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/status-Phase%201%20complete-brightgreen?style=for-the-badge" alt="Status" />
</p>

<p align="center">
  <img src="docs/screenshots/tour.gif" alt="Stockily walkthrough: stock, quality, invoicing, multi-site transfers and scan" width="860" />
</p>

> Every screenshot below is captured from the real running app (NestJS API + Vite web app + PostgreSQL) loaded with the repo's own demo seed (`npm run db:seed:demo`), plus the design docs in `docs/`.

## Table of contents

- [Overview](#-overview)
- [Features](#-features)
- [Screenshots](#-screenshots)
- [Architecture](#-architecture)
- [Tech stack](#-tech-stack)
- [Requirements](#-requirements)
- [Installation and configuration](#-installation-and-configuration)
- [Usage](#-usage)
- [Project structure](#-project-structure)
- [Testing](#-testing)
- [Troubleshooting and FAQ](#-troubleshooting-and-faq)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)
- [Author](#-author)

## 🧭 Overview

**Problem.** Small and mid-size Algerian wholesalers and retailers juggle stock, batch quality, and invoices in spreadsheets, and have to produce invoices that satisfy Decree 05-468 (mandatory mentions, DZD only, amount in words).

**Solution.** Stockily is a modular, multi-tenant platform where each organization subscribes to modules (15-day trial on signup). Stock, multi-site transfers, quality control, invoicing and barcode scanning share one ledger-based data model, with Algerian invoice compliance built into the domain layer. The design principle is hexagonal modularity: business rules live in framework-free `domain-*` packages, which keeps a future local/offline mode possible.

## ✨ Features

Phase 1 ships five modules, each gated by a per-organization entitlement:

- **Stock**: products and categories, append-only stock movements (receipt, sale, adjustment, transfer), weighted average cost, low-stock thresholds, per-batch remaining quantities derived from the ledger, quantities capped at available stock. Live updates over Socket.IO.
- **Multi-site**: several warehouses or points of sale per organization, inter-site transfers with driver info. Stock moves when the transfer is delivered, not when it is created.
- **Quality**: batches and lots, quality checks, non-conformities that quarantine stock, a scheduled expiry sweep that raises near-expiry alerts, and a resolve flow for quarantined lots.
- **Invoicing**: gapless per-organization invoice numbering, multi-line invoices with tax rates, a partner directory (clients and suppliers, NIF), flexible payments (partial, mark-paid, undo), overdue reminder emails (SMTP or a logging no-op), amount in words in French and Arabic, PDF generation.
- **Scan**: barcode/QR labels with printable label PDFs, scan-to-resolve a product or lot, and a "Vente rapide" retail-till mode (cart, paid or unpaid on the spot). Camera scanning uses `BarcodeDetector` with a manual / USB-scanner fallback; a mobile home screen is included.
- **Platform**: signup/login with short-lived JWT access tokens and rotating refresh tokens (logout, logout-everywhere, silent refresh on the client), roles and permissions, an audit log written by an interceptor on mutating endpoints, org legal profile and logo.
- **Hardening**: CORS allowlist, `helmet`, rate limiting (stricter on auth), a global exception filter that does not leak internals, queries scoped by `orgId`, and a Docker `HEALTHCHECK` backed by a real Postgres round-trip (`GET /health`).

## 📸 Screenshots

| Stock | Quality |
| --- | --- |
| ![Stock management with KPIs and per-site levels](docs/screenshots/stock.png) | ![Batches, expiry and non-conformities](docs/screenshots/quality.png) |

| Invoicing | Invoice detail (FR + AR amount in words) |
| --- | --- |
| ![Invoice list with totals and status](docs/screenshots/invoicing.png) | ![Invoice detail with payments](docs/screenshots/invoice-detail.png) |

| Multi-site | Scan: quick sale |
| --- | --- |
| ![Sites overview](docs/screenshots/sites.png) | ![Retail till mode](docs/screenshots/scan-quick-sale.png) |

| Partners directory | Mobile home |
| --- | --- |
| ![Clients and suppliers](docs/screenshots/partners.png) | <img src="docs/screenshots/mobile-home.png" width="260" alt="Mobile home with Applications and Scan shortcuts"> |

<details>
<summary><b>Design docs (wireframes, brand system)</b></summary>

The product was designed before it was built. The high-fidelity wireframes, brand system and pricing grid live in [`docs/`](docs) as standalone HTML, and the real app was built to match them.

| Wireframe (design) | Brand system |
| --- | --- |
| ![Wireframe of the stock screen](docs/screenshots/wireframes.png) | ![Brand system](docs/screenshots/brand-system.png) |

</details>

## 🏗 Architecture

The core idea is hexagonal modularity. Business logic lives in framework-agnostic `domain-*` packages that talk to the outside world only through ports. Prisma adapters implement those ports in `infra-db`, and NestJS controllers are a thin HTTP shell. The rule is enforced by ESLint (`no-restricted-imports` and `@nx/enforce-module-boundaries`), not just by convention, which keeps a future local/offline mode possible.

```mermaid
flowchart LR
    subgraph Web["apps/web (React 19 + Vite)"]
        UI[Pages: Stock, Quality, Invoicing, Sites, Scan]
        UI --> API_CLIENT[API client + silent token refresh]
    end

    subgraph Api["apps/api (NestJS 11)"]
        direction TB
        GUARDS["Guard chain<br/>JWT auth, entitlement, permission, site scope"]
        AUDIT[Audit interceptor]
        CTRL[Controllers + DTO validation]
        GW[Socket.IO gateway]
        GUARDS --> CTRL
        CTRL --> AUDIT
        CTRL --> GW
    end

    subgraph Domain["packages/domain-* (pure TypeScript)"]
        STOCK[domain-stock<br/>movements, avg cost, thresholds]
        QUAL[domain-quality<br/>batches, checks, quarantine]
        INV[domain-invoicing<br/>VAT math, amount in words]
        TEN[domain-tenancy]
    end

    subgraph Infra["packages/infra-db"]
        PORTS[Prisma data ports<br/>PrismaStockDataPort, PrismaQualityDataPort]
        SCHEMA[(Prisma schema + migrations)]
    end

    API_CLIENT -- REST /api --> GUARDS
    GW -. stock events .-> UI
    CTRL --> STOCK & QUAL & INV & TEN
    STOCK & QUAL -- ports --> PORTS
    PORTS --> SCHEMA --> PG[(PostgreSQL 16)]
    CTRL -. SMTP optional .-> MAIL[Invoice reminders]
```

<details>
<summary><b>Data model (simplified ER diagram)</b></summary>

```mermaid
erDiagram
    Organization ||--o{ Site : has
    Organization ||--o{ User : has
    Organization ||--o{ OrganizationModuleEntitlement : subscribes
    Module ||--o{ OrganizationModuleEntitlement : gates
    User ||--o{ UserRole : has
    Role ||--o{ RolePermission : grants
    Product ||--o{ StockLevel : "per site"
    Product ||--o{ StockMovement : ledger
    Product ||--o{ Batch : lots
    Batch ||--o{ QualityCheck : inspected
    Batch ||--o{ NonConformity : raises
    Site ||--o{ StockTransfer : "from / to"
    Partner ||--o{ Invoice : billed
    Invoice ||--o{ InvoiceLine : contains
    Invoice ||--o{ Payment : settled
    Invoice ||--o{ InvoiceReminder : chased
    Organization ||--o{ AuditLog : records
```

The full schema (26 models) is in [`packages/infra-db/prisma/schema.prisma`](packages/infra-db/prisma/schema.prisma).

</details>

## 🧰 Tech stack

| Layer | Tools |
| --- | --- |
| Monorepo | Nx 23, module-boundary lint rules |
| Backend | NestJS 11, Socket.IO, class-validator, pdfkit, nodemailer, bcryptjs, helmet, @nestjs/throttler |
| Frontend | React 19, React Router 7, Vite 8 |
| Data | PostgreSQL 16, Prisma 6 (migrations and seeds) |
| Testing | Jest (api, plus e2e specs against a real Postgres), Vitest |
| DevOps | Docker Compose (Postgres, api, web on nginx), GitHub Actions CI (lint, build, test) |

## 📋 Requirements

| Item | Requirement |
| --- | --- |
| OS | Windows, macOS or Linux (developed on Windows; Docker images are Linux/alpine) |
| Node.js | 22 or newer (the Dockerfiles use `node:22-alpine`, CI runs Node 24). Vite 8 needs a recent Node 22 release. |
| npm | The version bundled with Node (a `package-lock.json` and npm workspaces are used) |
| Docker | Docker with Compose v2, used for PostgreSQL 16 (or bring your own PostgreSQL 16) |
| Database | PostgreSQL 16, user/password/database `stockily` by default |
| Ports | `5432` (Postgres), `3000` (API, override with `PORT`), `4200` (web) |
| Hardware | No GPU or special hardware. A camera is only needed to try camera barcode scanning (needs HTTPS or `localhost`) |
| Accounts / API keys | None required. SMTP credentials are optional (invoice reminder emails are only logged without them) |

## ⚙ Installation and configuration

```bash
git clone https://github.com/ORD1STAR/stockily.git
cd stockily

docker compose up -d postgres        # Postgres on localhost:5432
npm install
cp .env.example .env                 # dev defaults; set a real JWT_SECRET for anything else
npx nx sync                          # sync TypeScript project references (Nx workspace)
npm run prisma:migrate               # create the schema
npm run db:seed                      # module registry + system roles
npm run db:seed:demo                 # demo organization with sample data
npx nx serve api                     # http://localhost:3000/api
npx nx serve web                     # http://localhost:4200 (in a second terminal)
```

> `npx nx sync` keeps the generated TypeScript project references in step with the workspace. Run it after cloning and again after adding a package or changing dependencies between projects. On Windows, stop `nx serve api` before running `npm run prisma:migrate` or the Prisma client regeneration can fail with `EPERM`.

### Environment variables

Configuration is read from a single root `.env` (copied from [`.env.example`](.env.example)).

| Name | Required | Description | Example |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string used by Prisma and the API | `postgresql://stockily:stockily@localhost:5432/stockily?schema=public` |
| `JWT_SECRET` | yes in production | Signing secret for JWTs. The API refuses to start in production without it. Generate with `openssl rand -hex 32` | `YOUR_RANDOM_64_CHAR_HEX_SECRET` |
| `JWT_ACCESS_TTL` | no | Access token lifetime | `15m` |
| `JWT_REFRESH_TTL_DAYS` | no | Refresh token lifetime in days | `30` |
| `CORS_ORIGIN` | no (yes in production) | Comma-separated allowlist of browser origins | `http://localhost:4200` |
| `PORT` | no | API port | `3000` |
| `SMTP_HOST` | no | Enables real email sending for overdue reminders; unset means emails are only logged | `smtp.example.com` |
| `SMTP_PORT` | no | SMTP port | `587` |
| `SMTP_SECURE` | no | Use TLS from the start of the connection | `false` |
| `SMTP_USER` | no | SMTP username | `YOUR_SMTP_USER` |
| `SMTP_PASS` | no | SMTP password | `YOUR_SMTP_PASSWORD` |
| `SMTP_FROM` | no | Sender address | `no-reply@your-domain.example` |

### Run everything with Docker

`docker compose up -d` builds and runs Postgres, the API and the web app (nginx, on `http://localhost:4200`). Migrations and seeding are not automatic: run `npm run prisma:migrate && npm run db:seed` once against the same Postgres first. The compose services are an alternative to `nx serve` and use the same ports, so do not run both. The production checklist (secrets, CORS, SMTP, TLS) is in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## 🚀 Usage

1. Open `http://localhost:4200`.
2. Log in with the demo account created by `db:seed:demo`: `demo@stockily.dz` / `Demo1234!` (local development data only). Or sign up at `/signup` to create a fresh organization with a 15-day trial on all Phase 1 modules.
3. Explore Stock, Multi-site, Quality, Invoicing and Scan from the application launcher.

Useful commands:

| Command | Purpose |
| --- | --- |
| `npx nx run-many -t lint build test` | Lint, build and test every project (what CI runs) |
| `npx nx graph` | Project dependency graph |
| `npm run prisma:validate` / `prisma:generate` / `prisma:migrate` | Prisma schema tooling |
| `npm run test:e2e:db:setup` | Create and migrate the `stockily_test` database for the e2e specs |

Do not run `db:seed:demo` in production, it creates a fake organization.

## 🗂 Project structure

<details>
<summary><b>Show tree</b></summary>

```
apps/
  api/                 NestJS backend: auth, tenancy guards, stock, sites, quality, invoicing, scan, realtime, audit
  web/                 React (Vite) frontend
packages/
  domain-stock/        movement service, average cost, thresholds (framework-agnostic)
  domain-quality/      batches, checks, quarantine, expiry logic
  domain-invoicing/    VAT math, amount in words (FR/AR)
  domain-tenancy/      tenancy primitives
  shared-types/        contract types shared by api and web
  shared-ui/           shared React components
  infra-db/            Prisma schema, migrations, seeds, port implementations
scripts/               setup-test-db.mjs (e2e database helper)
docs/                  Action Plan, 7 milestone logs, wireframes, brand system, pricing grid, operations notes
```

</details>

## 🧪 Testing

```bash
npm run test:e2e:db:setup        # once, needs the Postgres container running
npx nx run-many -t lint build test
```

Unit tests run with Jest (api) and Vitest (web and packages). The api e2e specs run against a real PostgreSQL database (`stockily_test`) rather than a mocked Prisma client, because tenancy and permission logic is the thing being tested. After any schema change, migrate the secondary databases too (command in [`docs/OPERATIONS.md`](docs/OPERATIONS.md)). CI (GitHub Actions) runs lint, build and test on every push and pull request.

## 🩺 Troubleshooting and FAQ

<details>
<summary><b>Prisma "column ... does not exist" when running <code>nx test api</code></b></summary>

`npm run prisma:migrate` only migrates the database in the root `.env`. The e2e databases (`stockily_test`, `stockily_invoicing_test`, `stockily_invoicing_dev`) are not kept in sync automatically. Run the `prisma migrate deploy` loop documented in `docs/OPERATIONS.md`.

</details>

<details>
<summary><b>EPERM during Prisma client generation (Windows)</b></summary>

The running `nx serve api` process locks the Prisma query engine binary. Stop it, migrate, then restart.

</details>

<details>
<summary><b>The API refuses to start in production</b></summary>

`JWT_SECRET` must be set when `NODE_ENV=production`. Generate one with `openssl rand -hex 32`.

</details>

<details>
<summary><b>Camera scanning does not work</b></summary>

`getUserMedia` and `BarcodeDetector` need a secure context (HTTPS or `localhost`) and a browser that supports `BarcodeDetector`. A manual entry / USB scanner fallback is available.

</details>

<details>
<summary><b>Port 3000 or 4200 already in use</b></summary>

The Docker `api` and `web` services use the same ports as `nx serve`. Run one or the other, or set `PORT` for the API.

</details>

<details>
<summary><b><code>@org/api:typecheck</code> reports four errors in the e2e specs</b></summary>

Known quirk: a tsconfig project-reference issue with the specs' dynamic `import()`, documented in `docs/MILESTONE_7.md`. It is not a runtime bug.

</details>

## 🗺 Roadmap

- [x] Auth and tenancy, Stock, Multi-site, Quality, Invoicing, Scan
- [x] Security hardening pass (CORS, rate limiting, headers, real email capability)
- [x] Mobile home and Scan experience
- [ ] Postgres row-level security (deliberately deferred; tenant isolation currently relies on `orgId` scoping in every query, the design and risks are in `docs/OPERATIONS.md`)
- [ ] Phase 2 modules: Purchasing, CRM (shown locked in the UI)
- [ ] Phase 3: Accounting
- [ ] Local/offline mode (the reason the domain layer is kept framework-free)
- [ ] Fix the four e2e-spec typecheck errors

The repo keeps its real history (about three days of work). Each `docs/MILESTONE_*.md` file is the build log for one unit of work: what was built, the decisions behind it, and how to verify it. The UI copy is French (the target market); code and most docs are English or French.

## 🤝 Contributing

Issues and pull requests are welcome. Please run `npx nx run-many -t lint build test` before opening a PR, and keep business logic in the `domain-*` packages (the lint rules enforce the boundaries).

## 📄 License

Released under the [MIT License](LICENSE).

## 👤 Author

<table>
  <tr>
    <td><b>Hannoun Amine Amar</b><br/>AI Engineer / Fullstack Developer, Algeria</td>
    <td>
      <a href="https://www.linkedin.com/in/hannoun-amine/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
      <a href="mailto:hannoun.amine25@gmail.com"><img src="https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white" alt="Email" /></a>
      <a href="https://github.com/ORD1STAR"><img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" /></a>
    </td>
  </tr>
</table>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f766e,100:1d4ed8&height=120&section=footer" alt="footer" />
</p>
