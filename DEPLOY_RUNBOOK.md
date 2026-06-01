# Deploy Runbook — auto-deploy + smoke + auto-revert

> Created 2026-04-30 after the TICKET-043 PGRST201 fire. **Read the
> "Deploy doctrine" section of [CLAUDE.md](CLAUDE.md) first.** This file is
> the one-time setup checklist + day-to-day reference.
>
> **No staging environment** (Supabase free-tier project cap). The safety
> net is fast smoke + auto-revert PR. See doctrine for when to upgrade.

## What you need to do once (estimated: 15 minutes)

### 1. Create the smoke-test seed user + restaurant on prod

The smoke tests need a stable user and restaurant. One-time SQL:

1. Supabase Dashboard → Auth → Users → "Add user". Email
   `smoke-test@napkin.dev`, strong password. Save the password.
2. SQL Editor:
   ```sql
   -- Make the user a real profile
   insert into profiles (id, display_name, username)
   values (
       (select id from auth.users where email = 'smoke-test@napkin.dev'),
       'Smoke Test', 'smoke_test'
   )
   on conflict (id) do nothing;

   -- Create a restaurant for the smoke test
   insert into restaurants (id, name, address, city, country)
   values (gen_random_uuid(), 'Smoke Test Restaurant', '1 Test St', 'London', 'UK')
   returning id;
   ```
   Save the returned restaurant UUID — that's `PROD_SMOKE_TEST_RESTAURANT_ID`.

3. Mint a long-lived JWT for the test user:
   ```bash
   curl -X POST 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/auth/v1/token?grant_type=password' \
     -H "apikey: <PROD_ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"email":"smoke-test@napkin.dev","password":"<password>"}'
   ```
   Copy `access_token` from the response.
   - JWT default expiry is 1 hour. Bump it on the dashboard
     (Auth → Settings → JWT expiry) to e.g. **30 days = 2592000 seconds**.
     Re-mint monthly or set a calendar reminder.
   - You can also bump it once just to mint, then drop back to 1h. Choose
     based on how comfortable you are with a long-lived token in CI secrets.

### 2. Add GitHub secrets

Repo → Settings → Secrets and variables → Actions → New repository secret.

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal Access Token from https://supabase.com/dashboard/account/tokens |
| `SUPABASE_DB_PASSWORD` | Prod DB password |
| `PROD_ANON_KEY` | Prod anon key (same value as `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `napkin-app/.env`) |
| `PROD_SMOKE_TEST_JWT` | The `access_token` from step 1.3 |
| `PROD_SMOKE_TEST_RESTAURANT_ID` | UUID from step 1.2 |

### 3. Verify the workflow has permission to open PRs

Repo → Settings → Actions → General → "Workflow permissions":

- ☑️ **Read and write permissions**
- ☑️ **Allow GitHub Actions to create and approve pull requests**

Without this, the auto-revert PR step will silently fail.

### 4. Verify it works (one cheap dry-run)

```bash
# Smallest possible migration / function change to trigger the workflow
git checkout -b release/2026-04-30-pipeline-smoke-test
echo "-- pipeline test $(date)" >> supabase/migrations/$(ls supabase/migrations/ | tail -1)
git commit -am 'chore: smoke test the new prod pipeline'
git push -u origin release/2026-04-30-pipeline-smoke-test
# Open PR → review → merge → watch Actions tab
```

The workflow should:
1. Push migrations (no-op or trivial).
2. Deploy any changed edge functions (none here).
3. Run smoke tests against prod and pass.

If smoke fails on a no-op change, the issue is your secrets — re-check step 2.

---

## Day-to-day workflow

### Normal change (the 95% case)

```
work on feature
  → commit on a release/* branch
  → push branch
  → open PR to main
  → human review (you, or copilot review, or both)
  → merge PR
  → prod-deploy.yml runs automatically
  → ~90 sec later, you get a green check
  → done
```

### Smoke fails after deploy (the 5% case)

```
prod-deploy.yml runs
  → migrations applied + edge functions deployed
  → smoke test fails (e.g. PGRST201)
  → workflow auto-creates "auto-revert/<sha>" branch and opens a PR
  → you get a GitHub email titled "🚨 Auto-revert: smoke tests failed on <sha>"
  → click "Squash and merge" on that PR within ~5 min
  → prod-deploy.yml runs again on the revert commit, smoke green
  → users back to normal
  → you debug the smoke failure on a new branch and re-ship
```

**Do not just close the auto-revert PR without merging it.** If you close
it, prod stays broken. Either merge it or push a hot-fix commit ASAP.

---

## When to add a check to the smoke list

Edit [scripts/smoke/edge-functions.ts](scripts/smoke/edge-functions.ts).
Add an entry when:

- A new edge function with a critical read path ships.
- A bug bypassed the gate because the affected endpoint wasn't checked
  (this is mandatory as part of the postmortem — no exceptions).

Keep the list under ~20 checks. Smoke is a tripwire, not coverage.

---

## What this changes about agent process

The planner agent must now produce a **Blast Radius checklist** for any
ticket that touches a migration. Reviewers reject PRs where the checklist
is incomplete. See CLAUDE.md "Migration blast-radius checklist (planner
output, mandatory)" for the exact format.

This is the front-half of the safety net. The smoke test + auto-revert is
the back-half. With both in place, the TICKET-043-class bug should fail
either at planning (caught by the checklist) or within ~5 minutes of
shipping (caught by smoke).

---

## When to upgrade to staging-first

Switch on Supabase Pro ($25/mo) and set up Branching the moment any of
these is true:

- Real users (anyone who'd churn over a 30-second outage).
- More than ~3 prod-deploys per day.
- A second person committing to the repo.

The doctrine in CLAUDE.md and the prod-deploy workflow already assume
this future — no code changes needed beyond pointing the workflow at
branches instead of prod.
