---
name: ticket-218-219-review-state
description: Review-2 (a33fb44) outcome for TICKET-218/219 — approved with nits; the founder backfill runs inside the migration on prod deploy and a post-deploy check is owed.
metadata:
  type: project
---

TICKET-218 (location-aware search) + TICKET-219 (exhausted imports must still pin the ghost) passed dual review round 2 at commit `a33fb44` — APPROVE-WITH-NITS from the Claude cold reviewer. All seven round-1 findings are addressed except two marked partial: the search-tab "use my location" row still stays hidden for the rest of a mount after a transient permission-read throw (`app/(tabs)/search.tsx` predicate is `permissionStatus === 'undetermined'` only), and the edit-match city fallback double-stacks the locality ("Paris, Paris").

Carried-forward nits, none blocking: no timeout on the location settle (search box waits on the GPS fix); the backgrounded local-notification branch in `useProcessImportQueue` was not migrated with the toast-copy fix, so legacy all-ghost imports now notify nothing; `area` now participates in the `fn_enqueue_completeness` item hash (narrow `NONCE_REUSE_CONFLICT` window on a re-resolved chunk, same class as TICKET-215); the LIVE verified router still inserts raw `client_facts->'source'` where the new exhausted core nullifs the JSON null — pre-existing, worth its own ticket.

**Why:** TICKET-219's founder backfill for the three stranded Paris spots (job `5e9c0a29-…`) executes inside migration `20260901122730` on prod deploy, and its DO-block assertions hard-fail the deploy if they do not hold. Nothing verifies the outcome afterwards.

**How to apply:** after this release deploys, run the per-spot verification query (one live `wishlist_items` row, one fulfilled destination, one acked ledger row per ghost) before calling TICKET-219 done — the migration passing is not the same as the founder seeing his pins. Treat the nit list as the follow-up backlog, not as re-review material.
