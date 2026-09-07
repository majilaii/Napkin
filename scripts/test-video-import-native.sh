#!/usr/bin/env bash
# Local files only: source-preparation races, relaunch recovery and runtime lease.
set -euo pipefail
cd "$(dirname "$0")/.."
VIDEO_IMPORT_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/napkin-video-import-tests.XXXXXX")"
trap 'rm -rf "$VIDEO_IMPORT_TEST_DIR"' EXIT INT TERM
swiftc -swift-version 5 \
  napkin-app/modules/media-extract/ios/VideoImportPreparationStore.swift \
  scripts/tests/media-extract/VideoImportPreparationTests.swift \
  -o "$VIDEO_IMPORT_TEST_DIR/preparation-tests"
"$VIDEO_IMPORT_TEST_DIR/preparation-tests"
if [[ "$(uname)" == "Darwin" ]]; then
  swiftc -swift-version 5 \
    napkin-app/modules/media-extract/ios/VideoSpeechAuthorization.swift \
    scripts/tests/media-extract/VideoSpeechAuthorizationTests.swift \
    -o "$VIDEO_IMPORT_TEST_DIR/speech-tests"
  "$VIDEO_IMPORT_TEST_DIR/speech-tests"
fi
