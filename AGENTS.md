# Napkin release preference

- After an implementation has been reviewed and its required checks pass, merge it and publish a TestFlight build so Jacky can download and verify it. Do not wait for a separate "go ahead".
- Report the merged commit, TestFlight build number, and processing or availability status.
- Explicit instructions to hold, avoid merging, or avoid releasing always take precedence.

# Mandatory TestFlight release hygiene

- Publish TestFlight builds only through `scripts/release-testflight.sh <merged-sha>`. Manual release worktrees are prohibited; never create `/Users/jacky/napkin-build-*` or another persistent release checkout.
- Never run overlapping TestFlight releases. The wrapper owns an exclusive release lock through build, submission, and cleanup, and must refuse a second release before EAS increments another build number or the jobs can race over Apple provisioning profiles.
- The release wrapper must remove its temporary worktree, fresh dependency install, IPA, and other generated artifacts on every exit path: success, failure, or cancellation. A successful TestFlight upload does not waive cleanup.
- Before reporting a release complete, verify the wrapper exited successfully, `git worktree list --porcelain` contains no temporary release worktree, and neither `/private/tmp/napkin-testflight.*` nor `/Users/jacky/napkin-build-*` remains. If residue exists, clean it with `git worktree remove --force <path>` followed by `git worktree prune`; otherwise report the release as incomplete with the exact path.

# Completed task worktree hygiene

- After a task branch is merged and its required TestFlight release is complete, remove that task's implementation worktree and run `git worktree prune --expire now` before reporting completion.
- Delete only a worktree that is clean, whose HEAD is merged into `origin/main`, and which is no longer used by a live process. Never remove the primary checkout, a dirty worktree, an unmerged worktree, or another task's active worktree.
- Verify the completed task's path is absent both on disk and from `git worktree list --porcelain`. A merged task that leaves its own stale worktree behind is incomplete.
