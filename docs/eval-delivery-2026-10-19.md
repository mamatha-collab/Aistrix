# Eval delivery — 19 October 2026

Eval owns customer evidence, triage and a reproducible regression. Improve receives the issue context; Build → Test remains the single test runner.

## Delivered

- One Eval screen with app/status filters, three quality summaries, expandable current-draft validation and the existing daily customer-rating trend.
- Side-by-side feedback list and selected-report editor on wide screens; stacked layout on tablets. Shared question/answer details are collapsed initially.
- Twenty-report pages through the full server queue, including reports beyond the former 200-row cap. Status counts above 5,000 are explicitly marked incomplete. Manual refresh and last-updated information accompany the inbox.
- Persistent editor-only triage notes, visible write failures and retry. In-session input, expectation and note drafts survive app/report switches. Unsaved drafts are not durable across reloads.
- Shared empty evidence distinguished from evidence the customer did not share. Customer identity is excluded from the API fields.
- Existing regression links are respected, including edited cases with a different identifier. An unavailable linked test blocks duplicate creation. Deterministic creation remains retry-safe; a failed feedback link has its own retry without recreating the test.
- Saving a regression changes new feedback to investigating, never fixed. The quality checklist refreshes after linking. Test results are described as applying to the current saved draft, not as approval to publish.
- Verified status requires a linked regression, a nonempty verification note and a published app on the server. The UI asks the editor to confirm checking the regression and live release. This records a human review; it does not claim automatic verification or independently validate the note.
- Improve now shows a compact issue/note/regression context with links to Eval, Design and Test instead of repeating the feedback editor. Marketplace entry links are retained.
- Phone feedback stays a compact read-only maintenance view. It distinguishes shared empty evidence and discloses when more than its latest 200 reports exist; full triage remains on computer/tablet.
- Re-rating a run without sharing now clears evidence/comment previously attached to the feedback report while retaining the triage/test link. This cannot retract copies already saved by an authorized editor.

## Verification

- Production frontend build passed; lint passed with existing unrelated warnings.
- Frontend unit suite: 227 tests across 20 files passed.
- Full isolated backend check suite: 16 passed. The feedback suite was rerun successfully after adding verification enforcement.
- Combined desktop/mobile Monitor and operations suite: 14 passed, 14 viewport-specific skips. Final Eval/operations desktop suite: 7 passed, including notes/error recovery, 205-report pagination, privacy presentation, linking retry, edited/missing linked tests, unknown quality results and human verification confirmation.
- Live localhost Eval reviewed with the signed-in account. Its current app has no open feedback; populated triage is covered by synthetic browser fixtures. Screenshot: `verification/eval-live.png`.

## Release requirements

Deploy the matching frontend and backend together. These changes do not require a new migration, but the existing `app_feedback` schema/migration is required. Hosted verification with separate customer/editor accounts, permission revocation and a real release/test journey remains outstanding. Local tests do not constitute production deployment approval.
