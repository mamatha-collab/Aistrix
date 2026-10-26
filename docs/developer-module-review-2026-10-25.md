# Developer module review — October 25, 2026

Scope: Dev Studio (Design, Test, Deploy, Workflows, Monitor, Eval, Improve, Market, Version, Revenue, Secrets), its phone workspace, the Business screens that act on developer apps, and the API the module depends on. Method: read the code path of each step, walked the module in the browser against the no-account fixture, and checked the results against the API. Builds on the [October 22 review](developer-module-review-2026-10-22.md); its durable-run and email-queue fixes are in place.

## Fixed in this pass

| Area | Problem | Fix |
| --- | --- | --- |
| Deploy ↔ API | The release view said "ready" for drafts that Publish then refused over contract problems (invalid fields, a declaration that understates side effects). | `GET /v1/apps/{id}/release` now returns the same checks as Publish. Tested. |
| GitHub and Stripe returns | After GitHub sign-in or Stripe payout setup the developer landed on the default tab with no message. A failed GitHub connection (`github_connected=0`) and an expired payout link (`stripe_connect=refresh`) were ignored. | Each return opens the screen that shows the result (Improve or Revenue) with a message saying what happened. |
| Unpublish | One click took a live app offline with no question and no mention of what depends on it. | A confirmation names the workflows that have a step running the app (and whether their webhook is on). |
| Delete app (My apps) | Permanent delete said nothing about live users or workflows using the app. | The same dependency check in its existing confirmation. Not browser-verified (needs a signed-in owner). |
| Design readiness | "Deploy uses the same saved-version checks: all design checks pass" and a green "Deploy-aligned" badge appeared under a 45/100 "Incomplete" score. | Both only claim success at 100; otherwise they say the design is incomplete. |
| Promote dialog | Said "the app will remain live" for a first release, which may wait for staff review. | Wording follows the server's review state and whether the app is live. |
| Workflow editing | Two people saving the same workflow overwrote each other (open item from the October 22 review). | Saves carry the revision they opened; a stale save changes nothing and shows the other version. **Needs migration `20261025040000_workflow_revision.sql`**; until it is applied, saves behave as before. |
| Add-key buttons | Test and Deploy "Add key" did nothing when the shell had no key dialog. | They fall back to the Keys page the header button opens. |
| Business run page | A run waiting for approval could sit behind five newer runs. | Runs waiting for a decision are always listed first. |

## Needs your decision (not changed)

You design the UI, so these are listed rather than built.

1. **API features with no Dev Studio screen.** Spending limits (`/v1/spend`, per-key and per-workspace caps), private-only workflows (`flows.privacy`), review and continue for interrupted or half-done runs (`needs_review`, `…/continue`, `…/review`), test destinations and the three reference workflows (`/v1/test-destinations`, `/v1/reference-workflows`), contract declarations (timeout, data class, side effects in the blueprint), and the workflow check (`POST /v1/flows/{id}/validate`). They work through the API only. Workflow runs show a refusal as one line of text; there is no per-step list from the server's check.
2. **Phone.** The phone Developer workspace is read-only and has no Workflows, so it cannot decide an approval. The approval email and notice say "Open Dev Studio → Workflows → Runs". On a phone the path that works is Business → Workflows → open the workflow (waiting runs are listed first).
3. **Workflow status.** The Live/Draft badge and the left-panel dot only reflect the webhook link. A workflow with only a schedule shows as Draft.
4. **Native browser dialogs.** The Workflows tab (five places) and the Improve tab use `window.confirm` for "leave without saving"; the rest of Dev Studio uses its own dialog.
5. **Names.** The left panel groups apps as "Still Designing / Testing / Publishing"; the tabs say Design / Test / Deploy.
6. **Three progress panels in Design** (Design Readiness 0–100, Design → Test readiness x/4, Build flow) use different thresholds and can disagree.
7. **Delete.** Dev Studio has no way to delete or archive an app; the only path is Business → My apps → Delete.

## Still open from earlier reviews

- Paid developer plans (Free and Verified tiers are not paid subscriptions).
- Translation and Code Gen / Review app types are marked preview.
- Hosted acceptance: isolation, Stripe test mode, real email delivery, restore, load. See [developer-production-fixes-2026-10-22.md](developer-production-fixes-2026-10-22.md).
- Migration `20261025040000` is new and not applied anywhere. `20261024010000`–`20261025030000` are applied to staging only.

## Verification

- Backend: 29 isolated suites pass (release/promote agreement added).
- Frontend: 376 unit and database tests pass (workflow save protection, dependency lookup and the revision migration added); lint clean.
- Browser: 116 component journeys pass; six new journeys cover the unpublish question, the three return flows and the readiness wording. The Next route suite and the hosted-account suite were not re-run.
- Not verified: anything needing a signed-in staging account (real GitHub, Stripe, email, the delete confirmation).
