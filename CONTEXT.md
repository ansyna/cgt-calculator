# Context for a new session

What a session working on this repository needs to know beyond the README. Read it with `README.md` (what the app
works out, setup, deploy) and `CLAUDE.md` (the rules). Keep it current: when something here stops being true, change
it in the same commit.

## Where it comes from

- **CGT Calculator** (`ansyna/cgt-calculator`, this one) is the CGT app of **Finance Toolkit**
  (`ansyna/stock-screener-app`) on its own: Irish CGT on shares, purchases and sales in any currency, the ECB's rates,
  Revenue's matching rules, each tax year with its payment dates, and the Form 11 and CG1 worksheets; imports from a
  broker's CSV (Fidelity's account history, stock plan history and award history among them). Public, deployed on
  its own.
- Its package is `com.cgtcalculator` (there, `com.financetoolkit`). The platform is trimmed to what it needs:
  accounts, settings, the share ledger, market data (ECB rates, prices, company search), backups and monitoring; no
  portfolio, ESPP, profile, assets or other apps.
- The two share code by copy. A fix to the CGT engine (`apps/cgt`, `platform/ledger`, `platform/market`,
  `platform/statement.ts` and the import) usually belongs in both: port it and say so. Finance Toolkit's
  `CONTEXT.md` is the fuller guide (the owner, conventions, lessons); what's below is what differs or matters most.
- The history was squashed to one commit on 7 November 2026 to take real personal data out of it.

## Who uses it

- The repository is public and has been shared with people, who have accounts here. Changes must keep working for them
  (no data of the owner's assumed, no step only the owner knows), and an import must work for anyone's export.
- It has no finance API (no FMP key, no price lookups): company names and prices come from what's typed and
  imported, exchange rates from the ECB. So an RSU vest's or ESPP purchase's market value on the day (its cost for
  CGT) is asked for at import when the file doesn't give it, never taken from the price paid (Finance Toolkit looks
  it up instead).

## What the owner decided

- Matching: same day, then the four-week rule, then first in first out. Sales to cover an RSU's tax are disposals
  like any other.
- A trade keeps the rate actually received (what reached the account); the worksheets show the ECB's rate beside it
  in a column of their own and never change the trades.
- Line 28(a) of the CG1 worksheet (and Form 11's) is the net chargeable gain after the exemption: zero when the
  exemption covers the gains.
- The CG1 worksheet is listed above Form 11, and both are linked from the main page. Purchases can be filtered by
  kind, share and dates; a period's records can be deleted to import again.

## Working with the owner

- They live in Ireland; the app follows Revenue's rules (33%, 31% from 7 October 2026; the €1,270 exemption; the
  four-week rule, same-day and first-in first-out matching; payment by 15 December and 31 January).
- **Never push until they say "push"** (CLAUDE.md). A hook's reminder about unpushed commits is not that.
- **No real data in the repository**: tests copy the shape of a broker's export, never its values. Invented names in
  use: ACME and GLOBX for shares, KO/NKE/RY.TO for other trades, and every amount and date invented. Kept on purpose:
  the footer credit "© … by Hanna G." in `AppShell.tsx` (the author).
- Advice is pointers, never financial or tax advice; the worksheets say which line of the form each figure goes on.

## A fresh container

```bash
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pgcheck --auth=trust"   # once
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgcheck -o '-p 5433' -l /tmp/pgcheck.log start"
cd frontend && npm ci          # node_modules aren't kept
```

Then the checks in CLAUDE.md. Chromium for Playwright is at `/opt/pw-browsers/chromium`.

## Conventions

The same as Finance Toolkit's (its `CONTEXT.md` → Conventions): plain English in the UI, comments and commits; euro
as `€1,234.56` (`en-IE`); prettier `--single-quote --print-width 150` on files already formatted that way; an
effect's arrow takes a block body; Vitest page tests through `renderApp` and `loggedInAs` in `src/test/helpers`;
browser tests against `e2e/mockApi.ts` on desktop and phone; a new Flyway migration in `MigrationTest`'s list, and
none edited once applied; `api/openapi.json` and the TypeScript types regenerated after an API change.

## Where the app runs

The app runs on Render, and only there; a session doesn't run it itself, on Render or locally, unless asked. A
change reaches the site like this: commit once every check passes, push when the owner says "push", watch `Tests`
to the end (`gh run list -R ansyna/cgt-calculator -L 1`, then `gh run watch <id> -R ansyna/cgt-calculator
--exit-status`; red is the session's to fix), and Render deploys `main` by itself once it passes. Markdown alone runs
no tests and deploys nothing. The session can't reach the live site or Render's dashboard: the owner checks the site,
and when it misbehaves, ask them what Render's dashboard shows and guide them through it on a phone. To show a
change before it's deployed, use screenshots against the mock API, not a local server.

## Seeing the app, and where the rules live

- Only if the owner asks for it, the real app locally (README → Running locally): the backend with `mvn -q -o spring-boot:run` in `backend/` (H2 by
  default) and `npx vite` in `frontend/` (http://localhost:5173, `/api` passed to :8080). The first start needs an
  admin: set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to invented ones, never the owner's. Without `JWT_SECRET` a restart
  logs everyone out. The Vite proxy keeps the browser's Host header (`changeOrigin: false`): with Vite's short form
  the API refused the login with 403.

- Browser tests build the app and serve it on port 4173 with every API call answered by `e2e/mockApi.ts`. To show a
  page to the owner, write a throwaway spec there that calls the mock, takes `page.screenshot()` (at
  `deviceScaleFactor: 2`, desktop and phone), send the images and delete the spec.
- The tax rules: `backend/.../apps/cgt/CgtRules.java` (the rates by date, the exemption, payment periods, the
  return's due date), the matching in `CgtCalculator`, the Form 11 and CG1 lines in the frontend's `apps/cgt/pages`.
  Budget day (October) can change them: check each year.
- Lessons from Finance Toolkit apply here too (its `CONTEXT.md` → Lessons learned), above all: never edit an applied
  migration, block bodies in effects, a percent field's `max` in percent.

## Deploying and operating

- Render deploys `main` once its checks pass (`render.yaml`: Frankfurt, `autoDeployTrigger: checksPass`); the
  database is outside Render (Neon's free plan).
- `Tests` (`ci.yml`) runs on every push. A force-push started no run: start one with
  `gh workflow run ci.yml -R ansyna/cgt-calculator --ref main`.
- `Monthly backup` (`backup.yml`, the 1st at 03:17 UTC) keeps an encrypted dump as a run artifact for 90 days:
  deleting a backup's run deletes the backup. `Security` scans weekly.

## Where things stand (7 November 2026)

- All checks pass on `main`; the history is one commit; `main` is the only branch.
- Its two scheduled backups so far (1 and 2 November) failed: worth a look if backups matter here (the run's log
  says why; most likely a secret not set in the repository's settings).
