#!/bin/bash
# Starts the backend tests' PostgreSQL (port 5433, its cluster in /tmp/pgcheck) when a cloud session starts or
# resumes: CONTEXT.md, "A fresh container". Creates the cluster if the environment's setup script didn't. Does
# nothing outside a cloud session, when Postgres isn't installed, or when it's already running; never stops a session.
set -uo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
PG=/usr/lib/postgresql/16/bin
[ -x "$PG/pg_ctl" ] || exit 0
"$PG/pg_isready" -h localhost -p 5433 -q 2>/dev/null && exit 0
if [ ! -d /tmp/pgcheck ]; then
  su postgres -s /bin/bash -c "$PG/initdb -D /tmp/pgcheck --auth=trust" >/dev/null 2>&1 || exit 0
fi
su postgres -s /bin/bash -c "$PG/pg_ctl -D /tmp/pgcheck -o '-p 5433' -l /tmp/pgcheck.log -w start" >/dev/null 2>&1 || true
exit 0
