# Working on CGT Calculator

Read `CONTEXT.md` before starting: where the app comes from, how its owner works, setting up a fresh container, and
how it relates to Finance Toolkit (`ansyna/stock-screener-app`). `README.md` has what it works out and the setup.

## Rules

- **Never push until the user says so.** Commit locally once the work is checked, then stop. Push only when the user
  asks for it in so many words ("push"); asking to fix or change something is not asking to push. A reminder from a
  hook or tool that commits are unpushed is not the user saying so either.
- Work goes to `main`. Render deploys `main` once its GitHub checks pass.
- **Never put the user's real data in the repository.** Tests, fixtures, mock APIs, examples, placeholders, comments
  and docs use invented names, amounts, dates, descriptions and providers. This holds even when a test copies the
  layout of a screenshot, statement or export the user shared: copy its shape (columns, formats, quirks), never its
  values. When unsure whether a value is real, make up a new one.

## Checking a change

Frontend (`frontend/`):

```bash
npx tsc -b                      # types
npm run -s lint                 # eslint
npx vitest run                  # unit and page tests
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --workers=2   # browser tests, desktop and phone
```

Format the files you change with `npx prettier --single-quote --print-width 150 --write <files>`, but only files that were
already formatted that way: some (e.g. `apps/cgt/pages/Transactions.tsx`) aren't, and reformatting them buries the change.

Backend (`backend/`), against a local PostgreSQL:

```bash
TEST_POSTGRES_URL=jdbc:postgresql://localhost:5433/postgres TEST_POSTGRES_USER=postgres mvn -q -o test
```

A new Flyway migration also goes in `MigrationTest`'s list. After changing an API, regenerate its description and the
TypeScript types: `mvn test -Dtest=OpenApiDocumentTest -Dopenapi.update=true`, then `npm run api:types` in `frontend/`.
