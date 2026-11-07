---
name: run-the-app
description: How to run, start, launch, open, preview or deploy the CGT Calculator, and how to show a change to its owner. Use whenever asked to run or start the app, see it working, get a URL to try, or check a change in the real app. The app runs on Render; never start a local copy unless the owner asks for one in so many words.
---

# Running the CGT Calculator

The app runs on Render (its own service, beside a database on Neon), used by the owner and the people it's shared
with. It is always running; there is nothing to start.

When asked to run, start, open or preview the app:

1. Don't start a backend or a dev server, and don't hand out a `localhost` address or an invented login. Say the app
   is running on Render, where its users sign in with their own accounts; the address is in Render's dashboard.
2. If there's a change to see, it reaches the site this way: every check in CLAUDE.md passes, the change is
   committed to `main`, the owner says "push", it's pushed to `main` (even if the session began on a branch of its
   own), `Tests` passes on GitHub (`gh run list -R ansyna/cgt-calculator -L 1`, then
   `gh run watch <id> -R ansyna/cgt-calculator --exit-status`), and Render deploys it by itself a few minutes later.
   Markdown alone runs no tests and deploys nothing.
3. To show a change before it's deployed, take screenshots against the mock API, desktop and phone (CONTEXT.md), and
   send them.
4. This container can't reach the live site or Render's dashboard. When the site misbehaves, ask the owner what
   Render's dashboard shows and guide them through it on a phone.

A local server only when the owner asks for one in so many words (to debug, say): CONTEXT.md has the recipe, with an
invented admin and nothing of the owner's.
