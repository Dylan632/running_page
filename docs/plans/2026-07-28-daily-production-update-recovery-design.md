# Daily Production Update Recovery Design

## Problem

The scheduled activity publication succeeds and commits fresh artifacts, but
the exact-SHA CI gate can fail before Vercel receives a deployment. The current
failure is a browser race test that deliberately pauses a route request while
the production data repository enforces a 1.8-second request timeout. Under a
slower runner, the test can time out the resource it is trying to coordinate,
leaving the page unable to reach the expected city heatmap.

The scheduled production monitor has a separate deterministic failure: it
pipes output into `$RUNNER_TEMP/production-health/monitor.log` without first
creating the parent directory.

## Goals

- Keep the exact-SHA CI and Vercel promotion gates strict.
- Preserve the production request timeout and its fast failure behavior.
- Make the browser race test deterministic on supported Node runners.
- Ensure scheduled production-health evidence is always writable and
  uploadable.
- Restore the normal publication → CI → Vercel production flow.

## Design

### Browser-test request budget

The activity repository will read an optional Vite environment value for its
request timeout. Invalid or absent values will fall back to the existing
1.8-second production value.

The browser test's private Vite build will set a larger timeout. This affects
only the generated test bundle and allows the test-controlled request gate to
remain open long enough for the newer navigation to be issued. The production
bundle and runtime behavior remain unchanged.

The test will continue to assert the complete outcome: `year=Total`, no route
hash, the expected city heatmap title, and no browser runtime errors. It will
not be skipped and its navigation assertions will not be weakened.

### Production-health evidence

The scheduled monitor job will create
`$RUNNER_TEMP/production-health` immediately before running the monitor and
`tee`. The existing `pipefail` behavior remains in place, so either a monitor
failure or an evidence-write failure still fails the job.

A workflow contract test will verify that the directory is created before the
monitor log is written.

## Verification

1. Run the previously failing browser race test on Node 24.
2. Repeat the targeted test to check for timing instability.
3. Run the workflow contract tests.
4. Run the complete JavaScript delivery command, `pnpm run ci`.
5. Push the approved commits to `master`.
6. Observe GitHub Actions until CI succeeds and the exact SHA is deployed.
7. Verify the Vercel production deployment SHA and confirm the live running
   manifest matches the newly published artifact.

## Rollback

The changes are isolated to test-bundle configuration, timeout parsing, and
monitor artifact setup. If CI reveals an unexpected regression, revert these
commits; the existing Vercel production alias and rollback workflow remain
unchanged.
