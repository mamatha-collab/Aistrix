# Launch checklist: hosting Aistrix for 100 paying developers

October 20, 2026. Ready ≈ 60% → **≈ 70%** after today's work (±10). The product
is close to done; what remains is mostly hosting, third-party accounts,
legal text and decisions. Stripe and other providers are deliberately
integrated last, after functionality is complete.

Status: ✅ done in code · 🟡 code ready, needs a setting or account · ⬜ not started · ❓ needs a decision

## 1. Before inviting anyone

| | Item | Notes |
|---|---|---|
| 🟡 | Backend container | `aistrix-backend/Dockerfile` (+ `.dockerignore`, never ships `.env`). Mount a volume at `/data`. Not yet built here (no Docker on this machine). |
| ⬜ | Pick hosts | Backend: any container host. Frontend: any static host (`npm run build` → `dist/`, with every path falling back to `index.html`). |
| ⬜ | Domain + HTTPS | Then set `FRONTEND_URL`, `ALLOWED_ORIGINS`, `VITE_API_URL`, `GITHUB_REDIRECT_URI`, Supabase Auth site URL and redirect URLs. |
| 🟡 | Production database | `supabase db push` to production: migrations through `20261020020000` (see build-readiness.md for order: database before backend). |
| ⬜ | Supabase Auth email (SMTP) | Without a custom SMTP provider Supabase sends about 2 auth emails an hour: sign-up confirmations and password resets would stop after the first few. Set SMTP in Supabase → Auth (e.g. the same Resend account) and raise the rate limit. |
| ✅ | Scheduled flows without an outside cron | Built-in scheduler (`SCHEDULER_INTERVAL_SECONDS`, default 60). Each due schedule is claimed before running, so several servers or the old `/cron/*` endpoints never run it twice, and a failing run waits for its next slot instead of retrying (and spending) every minute. |
| ✅ | Several servers | GitHub connect links are signed and one-time across servers (`server_once`); payouts, batch jobs, schedules and notifications are claimed in the database. Visitor rate limits and the failure-alert counter remain per server (acceptable; they're safety limits). |
| ✅ | Missing-settings report | On startup the backend logs every required/recommended setting that isn't set; `/health/details` (with `X-Ops-Token`) lists them. |
| ✅ | Account export and deletion (API) | `GET /v1/account/export` (JSON, no secret values/keys), `GET /v1/account/deletion-check`, `POST /v1/account/delete` (typed confirmation). Deletion is refused while the person owns a team workspace or team apps, has active subscriptions, has paying subscribers, or is owed payouts. Removes their files from storage. |
| ❓ | Account export/deletion on screen | The API is ready; where it appears (e.g. Settings → Account) is your design call. |
| ✅ | Sales history survives app deletion | Deleting an app used to delete its purchases (and Revenue/CSV history). Now kept, shown as a deleted app. |
| ⬜ | Terms, Privacy, refund policy | `LegalPages.jsx` is placeholder text pending legal review. Needed before taking payments. |

## 2. Third-party accounts (when functionality is complete)

| | Item | What to set |
|---|---|---|
| 🟡 | Resend (Aistrix's own emails) | `RESEND_API_KEY`, `EMAIL_FROM` (verified domain). Until set, emails are only logged. |
| 🟡 | Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLIC_KEY`; enable Connect (Express); webhook events: `checkout.session.completed`, `payment_intent.succeeded`, `invoice.paid`, `customer.subscription.created/updated/deleted`, `charge.refunded`, `charge.dispute.created`. If the key has an IP restriction, add the backend's outgoing IPs. Then the test-mode journey (checkout → access → refund → dispute → payout) and reconciliation with Stripe's records. |
| 🟡 | AI providers | Platform keys with spending limits at each provider; set `RATE_LIMIT_PER_HOUR`/`PER_DAY` for free runs on platform keys. |
| 🟡 | Sentry, PostHog | `SENTRY_DSN`, `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`. |
| 🟡 | Ops alerts | `OPS_ALERT_WEBHOOK_URL` (Slack/Teams), `OPS_HEALTH_TOKEN`. |
| 🟡 | GitHub app | `GITHUB_CLIENT_ID/SECRET/REDIRECT_URI` for production. |
| 🟡 | Web search tool | `SERPAPI_KEY` (optional). |

## 3. Developer emails

| | Email | When |
|---|---|---|
| ✅ existing | New sale; buyer access; subscription ended; 80% of runs used; workspace invite | As before |
| ✅ new | Refund (to the developer), chargeback opened, payout failed (one a day), new customer feedback (one a day per app), Monitor alert: most runs failing or a release failing more than the last (once per app, kind and day) | Each is recorded once (`developer_notifications`), so retries and several servers never duplicate it. A failed email never breaks the payment/feedback/monitoring work. |
| 🟡 | Opt-out | `developer_profiles.email_alerts` (default on) is respected; a toggle on screen is your design call. |
| ⬜ | Welcome email; receipts beyond Stripe's | Not built. |

## 4. Developer tiers (both free) ✅

| | Free developer | Verified developer |
|---|---|---|
| Account cost | $0 | $0 |
| Draft apps | 5 | 10 |
| Published apps (incl. waiting for review) | 3 | 6 |
| Test runs | 20 a day, 1 at a time | 100 a day, 3 at a time |
| AI usage | Developer's own keys for everything their apps run | same |
| Publish approval | First publish reviewed by staff (Moderator → Approve); later releases go live | same |
| Usage analytics | Basic: runs, users, errors, satisfaction | Standard: + response times, cost, per-version health, alerts (and alert emails) |

- Limits live in `developer_limits` (change them without a deploy); staff have none. `DEVELOPER_TIERS=0` turns tiers off.
- Verified: staff call `POST /v1/admin/developers/{id}/verification` (or set `developer_profiles.is_verified`); developers can't set it themselves.
- `GET /v1/developer/plan` returns the tier, limits and usage, ready for a screen (placement is a design call).
- Developers always use their own AI keys, never Aistrix's: their apps (tests, previews, customers' runs, scheduled flows, AI-graded checks — graded with whichever provider key they have) and the developer tools (Build with AI, Create App, Prompt Studio, Design copilot, Improve). Aistrix's keys serve only Aistrix's own (staff) apps and business-user features (Reports, Flows).
- Apps already published or released before tiers count as approved.

## 5. Charging developers ❓

Aistrix doesn't charge developers today (money flows from app buyers). If
"paid developers" means developers paying for a plan: plans, checkout, plan
limits (apps, runs, seats), upgrade/downgrade/cancel, failed-payment handling
and invoices all need to be designed first.

## 6. Operations

| | Item | Notes |
|---|---|---|
| ✅ | Load test script | `aistrix-backend/scripts/load_test.py --base <staging> --users 100 --seconds 60`. Read-only by default; AI runs only with `--run-app` and a key (they cost money). Local smoke: 20 users × 5 s, 1,072 requests, 0 failures. Run it against hosted staging before launch. |
| ⬜ | Database plan | Supabase backups / point-in-time recovery, connection pool size for the expected load. |
| ⬜ | Status page, support channel, on-call | Who answers when the ops alert webhook fires. |
| ⬜ | Abuse and moderation | Admin/Moderator pages exist; check the review flow end to end and decide on public-app abuse handling. |
| ❓ | Marketplace fallback | When no listing is live, the Marketplace lists every published app. Keep? |
| ⬜ | Python SDK release | `aistrix-sdk` isn't published. |

## Runbook

- **Is it up?** `GET /health` (public). `GET /health/details` with `X-Ops-Token` shows the database project, run-tracking storage, process and missing settings.
- **Runs failing for everyone:** check the provider's status page and the platform key's spending limit; Monitor shows error kinds per app.
- **One release is bad:** Version → Roll back (refused with a clear message if someone released meanwhile; reload and retry).
- **Scheduled flows didn't run:** startup log line `scheduler:` errors; `SCHEDULER_INTERVAL_SECONDS` must be > 0 (or an outside cron calling `/cron/run-schedules` with `X-Cron-Secret`).
- **Payouts stuck "being sent":** a claim older than `PAYOUT_CLAIM_STALE_SECONDS` (15 min) is taken over by the next "Send owed payouts"; a transfer Stripe already made is recorded, never repeated.
- **Emails not arriving:** without `RESEND_API_KEY` they're only logged (`EMAIL (no key)`); auth emails depend on Supabase SMTP.
- **Restarting/scaling:** safe at any time; in-flight runs' outcomes are kept in the `/data` outbox and delivered after restart.

## Renaming the product

The name and domain are settings, so a rename (e.g. if "Aistrix" can't be
trademarked) needs no code changes:

- Frontend build: `VITE_BRAND_NAME`, `VITE_BRAND_DOMAIN` (screens, page title, support address, docs).
- Backend: `BRAND_NAME`, `BRAND_DOMAIN` (emails and sender address, messages, API title).
- Defaults live in `aistrix-frontend/src/lib/brand.js` and at the top of `aistrix-backend/main.py`.
- Stay fixed on purpose (developers' code relies on them): the `X-Aistrix-Signature` webhook header, the Python SDK package and class names, and internal storage keys.
- Outside the code: DNS, email sender records, Supabase Auth email templates, OAuth app names (GitHub, Stripe), and the logo.
