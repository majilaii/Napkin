---
name: sql-contract-test-gate
description: Where to check whether a supabase/tests/*.spec.sql contract test actually runs in CI — the explicit psql list in migration-replay.yml, not a glob.
metadata:
  type: reference
---

`.github/workflows/migration-replay.yml` replays the whole migration chain into a throwaway DB and then runs the SQL contract specs by an EXPLICIT `psql -f supabase/tests/<name>.spec.sql` list (around lines 130-170), plus two shell-driven concurrency suites. It is not a glob.

Consequences when reviewing a migration PR:
- A new `supabase/tests/*.spec.sql` file that is not added to that list is dead weight — it never runs. Check the list, not just the file.
- The specs run as the local superuser `postgres` against the container on port 54329, so a spec may legitimately `ALTER TABLE ... DISABLE TRIGGER` to construct a state the production guards forbid.
- `ON_ERROR_STOP=1` turns any failing `ASSERT` into a red job, so a green replay job IS evidence the assertions ran — but only for the files on the list.
- The job is gated on a paths filter (`steps.changes.outputs.run`), so a PR that edits only a spec file may skip the whole job.

Related: [[ticket-218-219-review-state]].
