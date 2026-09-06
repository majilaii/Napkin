---
name: builder-verification-battery
description: Exact verification commands the orchestrator expects from a Napkin builder, plus the stale Expo typed-routes tsc trap in worktrees
metadata:
  type: reference
---

Battery (run from `napkin-app` unless noted), report real exit codes:
- `npx tsc --noEmit` (whole app; slow, ~2 min)
- `npx eslint <touched files>` (flat config `eslint.config.js`; in zsh use `; echo $?`, `PIPESTATUS` is bash-only and prints empty)
- `npm test -- <pattern>` (jest, babel-jest, node env; sibling component tests mock `react-native` wholesale, copy that block)
- `node ../scripts/check-typography.mjs` (new files have a ZERO budget for literal fontSize / italic)
- Deno EF tests from repo root: `deno test --allow-env --allow-read --no-check <file>`; CI runs `deno test --allow-env --frozen supabase/functions/` so only import std URLs already in the lockfile.

**Trap:** in a worktree `npx tsc --noEmit` can fail on `app/(tabs)/*.tsx` with `Type '"/some-route"' is not assignable to ...` even though `app/some-route.tsx` exists; that is Expo's generated typed-routes d.ts being stale, not a builder error. Report it, do not touch `app/`.

**How to apply:** run the battery before the final report; state which failures are in untouched files with the output. See [[feedback_verification_battery_typography_guard]].
