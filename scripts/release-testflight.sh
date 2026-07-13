#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/release-testflight.sh <merged-sha>
       scripts/release-testflight.sh --self-test-cleanup [ref]
       scripts/release-testflight.sh --self-test-cancel [ref]

Builds and submits a merged commit to TestFlight from a temporary worktree.
The worktree and all generated build artifacts are removed on every exit path.
EOF
}

mode="release"
if [[ "${1:-}" == "--self-test-cleanup" || "${1:-}" == "--self-test-cancel" ]]; then
  if [[ "$1" == "--self-test-cancel" ]]; then
    mode="self-test-cancel"
  else
    mode="self-test"
  fi
  shift
  merged_ref="${1:-origin/main}"
  if [[ $# -gt 1 ]]; then
    usage
    exit 64
  fi
else
  if [[ $# -ne 1 ]]; then
    usage
    exit 64
  fi
  merged_ref="$1"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir/.." rev-parse --show-toplevel)"
tmp_root="$(cd /private/tmp && pwd -P)"
scratch_dir=""
release_worktree=""
child_pid=""
eas_cli_version="20.5.1"
lock_path="$tmp_root/napkin-eas-ios-local.lock"
lock_held=0

legacy_home_worktree() {
  local path

  for path in "$HOME"/napkin-build-*; do
    [[ -e "$path" ]] || continue
    printf '%s\n' "$path"
    return 0
  done

  return 1
}

worktree_is_registered() {
  git -C "$repo_root" worktree list --porcelain \
    | grep -Fqx "worktree $release_worktree"
}

temporary_release_residue() {
  local line
  local path

  while IFS= read -r line; do
    case "$line" in
      "worktree $tmp_root"/napkin-testflight.*/worktree)
        printf '%s\n' "${line#worktree }"
        return 0
        ;;
    esac
  done < <(git -C "$repo_root" worktree list --porcelain)

  for path in "$tmp_root"/napkin-testflight.*; do
    [[ -e "$path" || -L "$path" ]] || continue
    printf '%s\n' "$path"
    return 0
  done

  return 1
}

acquire_release_lock() {
  # macOS lockf locks the open file description inherited by every child.
  # The lock therefore survives with EAS if the wrapper is killed, and the
  # stable file avoids PID-reuse and unlink/reacquire races.
  exec 9>"$lock_path"
  if ! /usr/bin/lockf -s -t 0 9; then
    exec 9>&-
    echo "Another TestFlight release is already running." >&2
    echo "Wait for it to submit and clean up before starting another release." >&2
    return 75
  fi

  lock_held=1
}

run_child() {
  local child_status=0

  # Keep terminal-aware EAS commands in the wrapper's foreground process group.
  # Running asynchronously only lets Bash handle signals while it waits; job
  # control must remain disabled or EAS is suspended when it touches the TTY.
  "$@" &
  child_pid=$!
  wait "$child_pid" || child_status=$?
  child_pid=""

  return "$child_status"
}

signal_process_tree() {
  local parent_pid="$1"
  local signal="$2"
  local descendant_pid

  for descendant_pid in $(pgrep -P "$parent_pid" 2>/dev/null); do
    signal_process_tree "$descendant_pid" "$signal"
  done

  kill -s "$signal" "$parent_pid" 2>/dev/null || true
  kill -CONT "$parent_pid" 2>/dev/null || true
}

handle_signal() {
  local signal="$1"
  local status="$2"
  local child_signal="$signal"
  local watchdog_pid=""

  trap - "$signal"
  if [[ -n "$child_pid" ]]; then
    # Non-interactive Bash starts async children with SIGINT ignored. Forward
    # TERM for Ctrl-C, but preserve the wrapper's conventional exit code 130.
    if [[ "$signal" == "INT" ]]; then
      child_signal="TERM"
    fi

    signal_process_tree "$child_pid" "$child_signal"
    (
      sleep 5
      signal_process_tree "$child_pid" KILL
    ) &
    watchdog_pid=$!

    wait "$child_pid" 2>/dev/null || true
    child_pid=""
    kill "$watchdog_pid" 2>/dev/null || true
    wait "$watchdog_pid" 2>/dev/null || true
  fi

  exit "$status"
}

cleanup() {
  local command_status=$?
  local cleanup_failed=0
  local legacy_path=""
  local residue_path=""

  trap - EXIT
  # Cleanup is the release's final correctness gate. Ignore repeated signals
  # until removal, pruning, and residue verification have all completed.
  trap '' HUP INT TERM
  set +e
  cd /

  if [[ -n "$release_worktree" ]] && worktree_is_registered; then
    if ! git -C "$repo_root" worktree remove --force "$release_worktree"; then
      cleanup_failed=1
    fi
  fi

  if [[ -n "$scratch_dir" && "$scratch_dir" == "$tmp_root"/napkin-testflight.* ]]; then
    if ! rm -rf -- "$scratch_dir"; then
      cleanup_failed=1
    fi
  elif [[ -n "$scratch_dir" ]]; then
    echo "Refusing to remove unexpected scratch path: $scratch_dir" >&2
    cleanup_failed=1
  fi

  # If Git removal failed but guarded scratch deletion succeeded, prune the
  # now-missing worktree immediately instead of retaining stale metadata.
  if ! git -C "$repo_root" worktree prune --expire now; then
    cleanup_failed=1
  fi

  if [[ -n "$release_worktree" ]] && worktree_is_registered; then
    echo "Release worktree is still registered: $release_worktree" >&2
    cleanup_failed=1
  fi

  if [[ -n "$release_worktree" && -e "$release_worktree" ]]; then
    echo "Release worktree still exists on disk: $release_worktree" >&2
    cleanup_failed=1
  fi

  if residue_path="$(temporary_release_residue)"; then
    echo "Temporary TestFlight residue still exists: $residue_path" >&2
    cleanup_failed=1
  fi

  if [[ "$mode" == "release" ]] && legacy_path="$(legacy_home_worktree)"; then
    echo "Legacy release worktree still exists: $legacy_path" >&2
    cleanup_failed=1
  fi

  if [[ $lock_held -eq 1 ]]; then
    if ! exec 9>&-; then
      echo "Failed to release the TestFlight build lock: $lock_path" >&2
      cleanup_failed=1
    fi
    lock_held=0
  fi

  if [[ $cleanup_failed -ne 0 ]]; then
    echo "TestFlight release cleanup failed; the release task is incomplete." >&2
    if [[ $command_status -eq 0 ]]; then
      command_status=1
    fi
  elif [[ -n "$release_worktree" ]]; then
    echo "Removed temporary release worktree: $release_worktree"
  fi

  exit "$command_status"
}

if [[ "$mode" == "release" ]]; then
  legacy_path=""
  if legacy_path="$(legacy_home_worktree)"; then
    echo "Refusing to release while a legacy home-folder worktree exists: $legacy_path" >&2
    echo "Remove it with git worktree remove --force, then run git worktree prune." >&2
    exit 1
  fi

  git -C "$repo_root" fetch origin main
fi

merged_sha="$(git -C "$repo_root" rev-parse --verify "${merged_ref}^{commit}")"
if ! git -C "$repo_root" merge-base --is-ancestor "$merged_sha" origin/main; then
  echo "Refusing to release a commit that is not merged into origin/main: $merged_sha" >&2
  exit 1
fi

trap cleanup EXIT
trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

acquire_release_lock

existing_release_residue=""
if existing_release_residue="$(temporary_release_residue)"; then
  echo "Refusing to overlap existing temporary TestFlight residue: $existing_release_residue" >&2
  echo "Wait for its release process to finish, or remove it if it is verified stale." >&2
  exit 75
fi

scratch_dir="$(mktemp -d "$tmp_root/napkin-testflight.XXXXXX")"
release_worktree="$scratch_dir/worktree"
git -C "$repo_root" worktree add --detach "$release_worktree" "$merged_sha"

if [[ "$mode" == "self-test-cancel" ]]; then
  (
    sleep 1
    kill -INT "$$"
  ) &
  echo "Cancellation child started."
  run_child /bin/sleep 30
  echo "Cancellation self-test failed to interrupt the child process." >&2
  exit 1
fi

if [[ "$mode" == "self-test" ]]; then
  run_child /bin/bash -c 'printf "Child-process runner is terminal-safe.\n"'
  echo "Cleanup self-test created a disposable worktree at: $release_worktree"
  exit 0
fi

app_dir="$release_worktree/napkin-app"
ipa_path="$scratch_dir/napkin-${merged_sha:0:12}.ipa"
eas_working_dir="$scratch_dir/eas-local-build"
build_tmp_dir="$scratch_dir/tmp"
cd "$app_dir"

# Production is intentionally keyless so the shipping app uses Apple Maps.
unset GOOGLE_MAPS_IOS_KEY
unset EAS_LOCAL_BUILD_SKIP_CLEANUP
export EAS_LOCAL_BUILD_WORKINGDIR="$eas_working_dir"
export TMPDIR="$build_tmp_dir"
mkdir -p "$eas_working_dir" "$build_tmp_dir"

run_child npm ci
run_child npx --yes "eas-cli@$eas_cli_version" build \
  --platform ios \
  --profile production \
  --local \
  --non-interactive \
  --output "$ipa_path"

if [[ ! -s "$ipa_path" ]]; then
  echo "The local EAS build did not produce a non-empty IPA: $ipa_path" >&2
  exit 1
fi

run_child npx --yes "eas-cli@$eas_cli_version" submit \
  --platform ios \
  --profile production \
  --path "$ipa_path" \
  --non-interactive \
  --wait
echo "TestFlight submission completed; removing the temporary release worktree."
