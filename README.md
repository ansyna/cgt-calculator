# CGT Calculator

[![Tests](https://github.com/ansyna/cgt-calculator/actions/workflows/ci.yml/badge.svg)](https://github.com/ansyna/cgt-calculator/actions/workflows/ci.yml)

Irish capital gains tax on shares, for Form CG1 or Form 11: a web app (Spring Boot and React) where each person
records their purchases and sales, or imports them from a broker's CSV statement, and gets each tax year's CGT worked
out, with the figures for the return.

## What it works out

Per tax year:

- each sale's gain or loss in euro, every trade at the ECB reference rate of its own day (fetched from
  data-api.ecb.europa.eu and kept in `fx_rates`; a rate can also be typed). Each trade also keeps the ECB's rate of its
  day beside the rate it was entered with: looked up as it's saved, and for trades saved without it a minute after the
  app starts and every hour (`ShareTradeEcbRates`). "Purchases & sales" lists both rates, points out a rate used that
  differs from the ECB's by 0.05% or more, and filters the list by type (purchases, sales, RSU vests, ESPP), by share and
  by date;
- which shares each sale disposes of: those bought in the four weeks before it (the latest first), then the earliest
  still held (s.580 and s.581 TCA 1997); a loss on shares bought back within four weeks is restricted to those shares;
- the year's losses, then earlier years' unused losses, set against the gains before the €1,270 exemption, and the
  rate of the day of each sale on the rest (33%; 31% from 7 October 2026);
- what to pay by 15 December (sales from January to November) and by 31 January (December's; a refund when December's
  losses lower the year's CGT), the losses carried forward, and the panel L figures (quoted shares: number of disposals
  and aggregate consideration).

**Form CG1 worksheet** (`/cgt/cg1`): the capital gains tax return for someone with nothing else to declare (an employee
whose RSU vests are taxed through payroll, say), item by item as numbered on Revenue's Form CG1 2025.

**Form 11 worksheet** (`/cgt/form11`): the capital gains parts of the return line by line as numbered on Revenue's
Form 11 2025: panel L (lines 801–826), panel M (line 827: shares acquired, RSU vests at their market value) and the CGT
self-assessment (line 937), with what to leave blank, a copy button per figure, the workings, and a print layout.

Both worksheets work the return out at the rate each trade was entered with or, with "Exchange rates: ECB rate of the
day", at the ECB's reference rate of each trade's day, as Revenue converts at the rate of the day bought or sold. The
year's totals and each sale's figures are shown at both rates side by side.

**Importing a statement** ("Import a statement"): the CSV file is read in the browser. Fidelity's account history and
stock plan account history are recognised by their column names; for other layouts the columns are picked. The stock
plan history names companies, so each company's ticker is asked once and remembered, and its prices come from the
amounts. An RSU vest has no price on the statement and an ESPP purchase shows the discounted price paid: for both, the
market value on the day (on the payslip, or the purchase confirmation) is typed in, as it's their cost for CGT. Each row
is previewed as a purchase, RSU vest, ESPP purchase, sale or left out (dividends, cash, rows already recorded), and all
rows are recorded at once or none (up to 2,000 rows). A row the ECB has no rate for gets a field to type it.

Not covered: ETFs and other funds (exit tax), a spouse's or civil partner's gains and losses, shares held since before
2003, other assets. The rules are in `CgtRules` and `CgtCalculator` (backend, `apps/cgt`), with worked examples in
`CgtCalculatorTest`.

This is a tool to help prepare a return, not tax advice: check the figures against Revenue's guidance.

## Requirements

- Java 21 and Maven 3.9+
- Node.js 20+

## Running locally

Backend (http://localhost:8080), on an H2 database file in `backend/data/`:

```bash
cd backend
export ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='choose-a-password'   # first start only
mvn spring-boot:run
```

Frontend (http://localhost:5173, proxies `/api` to the backend):

```bash
cd frontend
npm install
npm run dev
```

Log in with the admin account. New users can sign up themselves, but they see the calculator only after an admin gives
them the `investor` (or `admin`) role under **Users**.

Or the production setup, with Postgres, in Docker (http://localhost:8080):

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='choose-one' docker compose up --build
```

## Deploying to Render

`render.yaml` is a Render Blueprint: it creates the web app, built from the `Dockerfile` (frontend and backend in one
image). A push to `main` is deployed only once GitHub's checks pass. The database is a Postgres outside Render: Render
allows one free database an account, and its free databases expire after a month. [Neon](https://neon.tech)'s free
plan has neither limit.

1. **The database.** Sign up at [neon.tech](https://neon.tech), create a project (region: AWS Europe Central 1,
   Frankfurt, where `render.yaml` puts the app) and click **Connect**. Note the connection details: the host (`ep-…….eu-central-1.aws.neon.tech`, without
   `-pooler`: turn off "Connection pooling"), the database (`neondb`), the user and the password.
2. **The app.** Sign up at [render.com](https://render.com) with GitHub and give Render access to this repository. In
   Render choose **New → Blueprint** and select this repository.
3. Fill in the values Render asks for: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (Neon's), `ADMIN_EMAIL`,
   `ADMIN_PASSWORD`, `CONTACT_EMAIL`, and for emails `MAIL_HOST`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM` (leave
   these empty to go without email). `JWT_SECRET` and `BACKUP_TOKEN` are generated, and the connection is encrypted
   (`DB_SSLMODE=require`).
4. Click **Apply**. When the service shows **Live**, open its `onrender.com` address and log in.

The app creates its tables on the first start. Render's free plan puts the app to sleep after a while without visitors
(the next visit takes up to a minute); Neon's free plan pauses the database when idle, and wakes it in a moment.

### Backups

On the 1st of each month `.github/workflows/backup.yml` downloads the app's data (users, roles, the activity log, the share trades,
CGT settings and each user's settings) as a SQL script from `/api/backup` (only with the secret `BACKUP_TOKEN`),
encrypts it with your passphrase and keeps it 90 days as an artifact of the run (**Actions → Monthly backup**; **Run workflow** backs up at any time). Set the
repository secrets once (**Settings → Secrets and variables → Actions**):

- `APP_URL`: the app's address, e.g. `https://cgt-calculator-x1y2.onrender.com`
- `BACKUP_TOKEN`: the value of `BACKUP_TOKEN` in the Render dashboard (the app's **Environment**)
- `BACKUP_PASSPHRASE`: a long passphrase of your own; keep a copy outside GitHub: without it a backup can't be read

To restore: let the app start once on the (new) database so the tables exist; decrypt the latest artifact with
`gpg --decrypt cgt-calculator-backup-YYYY-MM-DD.sql.gpg > backup.sql`; run
`psql "<the database's connection string>" --set ON_ERROR_STOP=1 -f backup.sql` (Neon's, from its **Connect**); then
delete `backup.sql`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | — | Initial admin, created when the database has no users |
| `JWT_SECRET` | required in production | Key for login tokens (≥ 32 bytes); without it (not on Postgres) a random one is used per start |
| `SESSION_DAYS` | `30` | How long a login lasts without use |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM` | — | SMTP server for password resets, email confirmations and invitations; without it admins pass the links on themselves |
| `APP_BASE_URL` | Render's `RENDER_EXTERNAL_URL` | Public address used in email links |
| `SPRING_PROFILES_ACTIVE=postgres` with `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | H2 file database | Postgres (used by Docker Compose and Render) |
| `DB_SSLMODE` | `prefer` | `require` for a database reached over the internet (Neon, as `render.yaml` sets it) |
| `CONTACT_EMAIL` | — | Shown to people waiting for access ("Contact admin at …") |
| `BACKUP_TOKEN` | — | The secret the monthly backup sends; without it the backup endpoint is off |
| `SENTRY_DSN` | — | Report errors to [Sentry](https://sentry.io) (off when empty) |

## Accounts

Logins last in an HttpOnly cookie, swapped on every renewal; the page keeps only a 15-minute token in memory. With
email set up, people reset forgotten passwords themselves, sign-ups confirm their email, and invitations are emailed.
Admins approve sign-ups (or invite people), manage roles, and see an activity log of logins and changes. Logins are
throttled against password guessing, and every response carries a strict Content Security Policy.

## Database changes

The schema is created and changed only by the versioned SQL scripts in `backend/src/main/resources/db/migration`
(Flyway), applied in order when the app starts; Hibernate only checks the entities match. To change the schema, add
the next script (`V2__what_it_does.sql`) in SQL that both Postgres and H2 (in its PostgreSQL mode) understand, and add
its version to `MigrationTest`. Never edit a script that has run.

## API

`api/openapi.json` describes every endpoint (OpenAPI 3.1). It is generated from the controllers by
`OpenApiDocumentTest`, and the frontend's types in `frontend/src/generated/api.ts` are generated from it; CI fails when
either is out of date. After changing the API:

```bash
cd backend && mvn test -Dtest=OpenApiDocumentTest -Dopenapi.update=true   # rewrite api/openapi.json
cd frontend && npm run api:types                                         # regenerate the TypeScript types
```

## Tests

Every push runs them on GitHub (`.github/workflows/ci.yml`): the backend tests (also on Postgres 16), type checking,
ESLint, the component tests, the browser tests on desktop and phone, and a build and scan of the Docker image. Locally:

```bash
cd backend && mvn test        # MigrationTest also runs on a real Postgres when TEST_POSTGRES_URL (+ _USER, _PASSWORD) is set
cd frontend && npm test       # component and page tests (Vitest)
cd frontend && npm run lint
cd frontend && npx playwright install chromium && npm run test:e2e   # browser tests, the API mocked (e2e/mockApi.ts)
```

[Renovate](https://docs.renovatebot.com) (`renovate.json`) proposes dependency updates, once the Renovate GitHub App is
installed on the repository.
