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

## Update — October 19, 2026

- **Version:** each published version shows its real-world runs and failure rate (last 30 days, from Monitor), and a release that fails noticeably more than the previous one is flagged with a suggestion to roll back. The "Coming soon" cards were removed.
- **Revenue:** totals are net of refunds; refunds and chargebacks are shown; a period filter (7/30/90/365 days, all time) and a CSV export for accounting were added. Payouts owed (sales before the payout account was ready, or failed transfers) can be sent with "Send owed payouts" — never twice: each payout carries a transfer group that is checked before sending.
- **Refunds (server):** `charge.refunded` reduces the sale and the developer's share, reverses that part of a payout already sent, and takes back an unused pay-per-run run on a full refund. `charge.dispute.created` flags the purchase.
- **Secrets:** secrets now belong to the app (not per editor). Each secret shows which tools use it, and secrets a tool needs but the app lacks are listed with an "Add" shortcut. Publishing is blocked until they are added (a missing secret used to become an empty value at run time).
- **Marketplace:** listings go live only through the server (`POST /v1/apps/{id}/listing/go-live`), which requires a published app and a complete listing. The database refuses a browser setting a listing live, only an app's editors can manage its listing, and a live listing no longer makes an unpublished app readable.
- Migrations `20261019030000_purchase_refunds` and `20261019040000_marketplace_listing_gate` are required.

## Update — October 20, 2026

Against the requirements baseline in `operate-manage-requirements-2026-10-19.md`.

- **Revenue — payouts can't be sent twice.** Before any transfer the server claims the purchase (`payout_status = 'transferring'`, only if the status and attempt count are still what it read), so of two concurrent attempts exactly one pays. The Stripe idempotency key is the payment plus the attempt number (no longer the hour). A transfer Stripe already made is recorded, not repeated. A claim left by a stopped server is taken over after 15 minutes. A refund that arrives while a payout is being sent is refused with 503 so Stripe retries it once the transfer is recorded; a refund recorded first lowers the payout (the claim reads the current row).
- **Revenue — complete ledgers.** Earnings and the CSV read every purchase page by page (no more silent 10,000 cap). Past 200,000 in a period, earnings say they're incomplete and the CSV is refused rather than partial. "Send owed payouts" covers all owed purchases (not the first 500), reports any it didn't reach in one request as remaining, and leaves alone a payout another attempt is sending.
- **Version.** Rollback and publish apply only if what's live hasn't changed since it was read; otherwise 409 "Another release was made…" and nothing changes. A publish refused this way leaves no orphan version in the history. Version's rollback sends the live version on screen.
- **Secrets.** A tool whose secret is missing (deleted, never added, or unreadable after an encryption-key change) now fails with a clear message and makes no outbound call, instead of sending an empty credential. Secret values are blanked out of tool results and errors before they reach the model, the run log or the person running the app. Empty values are refused; values are limited to 10,000 characters. Undecryptable secrets are reported to the operator.
- **Market.** Removed the false "Payments are in setup mode" notice, the Stripe registration stub and the price × runs "projected revenue" line. Listings are loaded by app, so every editor sees and edits the same listing; a save over a teammate's newer edit is refused and their version shown. A live listing disappears from the Marketplace while its app is unpublished (and returns on republish). Prices below the $0.50 card minimum are refused in the editor and at go-live (buyers couldn't pay them).
- **Sign-in checks.** A refused token is still 401; an Auth outage is now 503 and logged, not reported as "Unauthorized". Manage panels say "Your sign-in has ended…" on a 401.
- Migration `20261020010000_manage_hardening` is required (payout claim columns, listing/review visibility). Until it is applied, "Send owed payouts" fails on that database.

### Verification

- Backend: 17 suites pass (payments 63, release 29, manage 30, listing 8). New checks cover concurrent payout claims, attempt-numbered keys, stale claim takeover, refund during a payout, refund before a payout, paging past 1,000 rows, the truncation flag and CSV refusal, 1,200 owed payouts, rollback/publish races, missing-secret failure, secret redaction, and Auth outage vs refusal.
- Database (PGlite, every migration): 242 tests pass, including one-claim-wins on purchases, browsers unable to change payout state, unpublish hiding a live listing (and republish restoring it), and teammates reading the app's listing.
- Browser: 154 tests, 84 passed and 70 viewport-specific skips, none failed. New: stale-screen rollback, teammate listing visibility and conflict, no setup-mode notice, card-minimum pricing, remaining payouts and incomplete totals.
- Signed-in staging check: Market loaded with listings read by app and without the removed notices. Revenue couldn't be checked: Supabase reported the browser's session no longer exists ("Session from session_id claim in JWT does not exist"), so every API call returned 401.

### Estimates (same baseline, ±5)

| Area | Before | Now | What's left |
|---|---:|---:|---|
| Market | 80% | 90% | Buyer discovery → checkout → access on hosted staging. Decide whether the Marketplace's fallback (it lists every published app when no listing is live) should stay. |
| Version | 90% | 90–95% | Release/rollback seen from a separate end-user session on hosted staging. |
| Revenue | 80% | 90% | Stripe test-mode journey on hosted staging: checkout, duplicate/out-of-order webhooks, partial/full refunds, disputes, transfer reversals, reconciliation with Stripe's records. |
| Secrets | 90% | 95% | Hosted encryption key backup/recovery; two-editor access/revocation on hosted staging. |

What stands between these and 95% is now mostly hosted evidence (deployed backend + migrations, Stripe test mode, two real users), not code.
