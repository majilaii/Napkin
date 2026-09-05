#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/napkin-media-extract-tests.XXXXXX")"
trap 'rm -rf "$build_dir"' EXIT
# Compile the production helper against the real minimum iOS deployment target
# as well as the macOS execution target; no simulator is launched.
native_sdk_path="$(xcrun --sdk iphonesimulator --show-sdk-path)"
swiftc -swift-version 5 -target arm64-apple-ios15.1-simulator \
  -sdk "$native_sdk_path" -parse-as-library -emit-module \
  "$repo_root/napkin-app/modules/media-extract/ios/VideoFrameOCR.swift" \
  -o "$build_dir/VideoFrameOCR.swiftmodule"
swiftc -swift-version 5 -parse-as-library \
  "$repo_root/napkin-app/modules/media-extract/ios/VideoFrameOCR.swift" \
  "$repo_root/scripts/tests/media-extract/VideoFrameOCRTests.swift" \
  -o "$build_dir/media-extract-tests"
"$build_dir/media-extract-tests" "$repo_root" "$@"
