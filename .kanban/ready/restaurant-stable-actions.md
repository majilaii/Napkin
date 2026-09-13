# Restaurant logging: stable actions

## Outcome
Keep Check in and Log a meal fixed in position, label and purpose. Put exact-visit review actions and saved review content in a separate dated row.

## Done when
- Main actions stay stable before/after check-ins, review saves, history selection, loading and errors.
- Bare row Add review updates the exact visit; a saved row shows actual content and opens read-first.
- Generic Log a meal always starts new; attaching to an owned eligible check-in is explicit and preserves existing robust save/retry semantics.
- Native read-only QA, relevant regressions, independent review and CI pass; authorized TestFlight wrapper release and worktree cleanup complete.

## Constraints
User approved direction A with “Not bad - good” after an interactive two-direction comparison on 13 September. Use own Codex design. Preserve repeat visits, ownership, null dates, photo lifecycle, audience and nonce guarantees. No backend/schema changes planned. No live writes for UI QA. Socials remains outside this approved change.

## Design
Permanent Check in / Log a meal. YOUR VISITS below carries date/time, bare Add review or stars/note/photo preview. Finished row opens entry detail; history affects only selected content. Composer target says New visit by default, with an explicit Use check-in / multiple-choice sheet. Dirty retargets require discard/cancel; uncertain saves never retarget. No primary View your review and no New visit action sheet.

## Progress and result
13 September: implemented on `codex/restaurant-stable-actions`, based on `origin/main` at `5f1638a`. The permanent buttons and dated content row use the existing design system. The composer explicitly chooses an owned unreviewed check-in and fences stale Save callbacks during target transitions.

Verification: 79 focused regressions passed (25 visit actions, 40 composer, 14 suggestion hook), including exact-entry routing, repeat/nonce protection, dirty retargets, fresh owned hydration, late uploads and both same-tick stale-Save races. Fresh independent Codex source review: APPROVED, no P0-P2 findings. Native read-only QA verified saved review, new draft after a review, read-first entry detail, history and no-history states. Temporary display fixtures also verified same-day history, exact target attachment, pristine and dirty retargets, and loading/failure/new-visit recovery. All four temporary fixture files were restored byte-for-byte; production restoration was visually confirmed in the simulator. Seventeen native screenshots were verified at 1170x2532. Final production-only independent review: APPROVED, no P0-P2 findings.

Durable screenshots and native evidence: `/Users/jacky/Documents/Codex/Napkin/restaurant-stable-actions-2026-09-13-51fe/qa/`. Typography policy, route-tree guard and diff checks pass. Full app verification passed: 226 Jest suites / 1,897 tests, no failures or skips; TypeScript passed; ESLint 0 errors / 238 existing warnings (limit263). CI, release and cleanup evidence pending.
