# Manage hardening — October 15, 2026

## Delivered

- Desktop and mobile use the same recorded Revenue component and authenticated API client. The primary figures are purchase-ledger earnings, pending amounts, per-app totals, and recent purchases. They cover the developer account across workspaces and are labeled USD.
- Desktop pricing/run-based projections are secondary, collapsed, and explicitly identified as estimates rather than earnings. Token-cost totals cover only token-bearing runs; an aggregate projected margin is not presented when cost coverage is incomplete.
- Desktop and mobile use the same Secrets panel. Replacement and deletion require explicit confirmation. Failed requests do not remove displayed metadata or display a success message. Values remain hidden; replacement input clears only after a successful save.
- Secret metadata reads and deletion now require current app-edit permission, matching writes. A revoked editor cannot delete a secret merely because they originally created it. The existing per-user secret ownership filter remains in place.
- Missing secret encryption/storage returns a service error instead of an empty list. Malformed metadata blocks changes; incomplete earnings responses fail visibly rather than becoming zero amounts.
- Payout status errors are visible and retryable. Charges-enabled status is not confused with payouts-enabled status or confirmation of a bank deposit. Optional feature-flag configuration no longer claims staged rollout routing is enabled.

No migrations are required. The backend must be deployed/restarted for its permission and infrastructure checks to take effect.

## Verification

- Final checks: 213 frontend/database tests, all 11 backend suites, eight targeted desktop/mobile browser journeys, and the production frontend build passed. Lint completed with existing warnings.
- New Manage API check script: 22 checks passed with synthetic records and fake services. Covers authentication, app-edit permission, revoked access, encrypted storage, metadata-only responses, missing infrastructure, and separate developer earnings ledgers.
- Eight API-client tests cover authentication, valid zero earnings, incomplete ledgers, invalid secret metadata, failed deletion, no-content deletion, and malformed responses.
- Browser journeys use synthetic data. They cover desktop/mobile revenue parity, retryable outages, confirmed deletion with cancellation and failed-write recovery, confirmed replacement, app isolation, and payout-status error handling.

## Signed-in local verification

The provided `http://localhost:5173/developer` opened an existing authenticated session. Read-only checks observed:

- Revenue loaded recorded zero balances and the no-purchases state.
- Payout account status reported setup incomplete.
- Secrets loaded an empty metadata list without showing values or modifying secrets.
- Published versions showed v1 live and a later saved v2. Opening the v2 rollback confirmation and cancelling retained v1 as live.

Evidence: [local recorded Revenue panel](verification/manage-revenue-local.png).

No payment, payout setup, secret modification, deletion, publication, or rollback was performed against the real account.

## Remaining staging sign-off

The local process has no `E2E_BASE_URL`, `E2E_EMAIL`, or `E2E_PASSWORD` configured. The supplied URL is localhost; these observations do not prove a hosted deployment works.

1. Deploy the matching frontend/backend to hosted staging and verify HTTPS/CORS/authentication.
2. Use two dedicated users/workspaces against the deployed permission rules: editor access, viewer denial, revoked-role denial, and ledger isolation. Use disposable secrets and synthetic values.
3. Use a Stripe test-mode Connect account and purchases to verify checkout → purchase ledger → earnings → pending/paid accounting. Do not treat the empty ledger check as payment reconciliation.
4. Verify refunds, failed payments, webhook retries/idempotency, and reconciliation before financial production sign-off. Bank payouts and dates require provider evidence; the UI alone cannot prove receipt.
5. Verify a disposable app's release/rollback with a separate end-user session. The local live-account smoke check only opened and cancelled the confirmation.

Secret rotation/audit history and complete financial reconciliation remain separate work items. Do not infer full production readiness from passing fixture tests.
