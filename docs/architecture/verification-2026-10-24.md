# Local verification, 2026-10-24

Scope: repository audit plus mixed-answer outbound DNS validation correction.
Existing uncommitted application changes were retained. No hosted configuration,
database migrations, provider calls, deployments or transactions were performed.

- New `check_outbound_urls.py`: **16 passed, 0 failed** outside the sandbox.
  DNS resolution and HTTP clients are mocked, including the redirect case.
- Frontend Vitest baseline: **31 files, 299 tests passed**. The first attempt
  failed with sandbox temporary-file ENOENT errors; rerunning with TEMP/TMP set
  to the existing workspace `.test-tmp` directory passed. No frontend source
  was changed by this increment.
- `git diff --check`: passed.
- Full backend pytest wrapper: **23 isolated suites passed in 148.85 seconds**,
  including the new outbound URL checks and existing workflow/security suites.

Windows asyncio stalled even for a minimal `asyncio.run(asyncio.sleep(0))` in
the restricted sandbox. The backend suite was therefore rerun outside it using
the existing harness that blanks service credentials and fakes integrations.
Sandbox-stalled attempts do not count as passes or application failures.

The fix changes DNS validation from any public answer to all public answers.
It does not solve connection-time DNS rebinding or provide destination allowlists.
Actual capacity, monthly invoices, private-model quality, hosted tenant isolation,
restart safety and backup restoration remain unverified. Phase 1 is not complete.
