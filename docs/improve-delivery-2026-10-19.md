# Improve delivery and fixed-scope readiness — 2026-10-19

Engineering completion estimates, rounded to 5 points with approximately ±5-point uncertainty. These use the existing scope and weights: core functionality 50, reliability 20, security 20, evidence 10. They are not uptime measurements or launch approval.

| Area | Core /50 | Reliability /20 | Security /20 | Evidence /10 | Rounded completion |
|---|---:|---:|---:|---:|---:|
| Monitor | 49 | 19 | 19 | 8 | 95% |
| Eval | 48 | 19 | 19 | 8 | 95% |
| Improve | 46 | 16 | 19 | 7 | 90% |

## Improve workflow

1. Review a selected issue and linked regression from Eval. Evidence editing and verification remain in Eval.
2. Edit a draft candidate system prompt. AI suggestions remain advisory and never silently replace the prompt.
3. Compare a released prompt and a candidate on the same input. The UI explicitly describes this as a prompt/model comparison; tools, files and complete workflows must be tested in Test.
4. Explicitly save the candidate into existing app fields, using the existing optimistic concurrency/access controls. A UUID improvement reference and selected source run are stored in change_note. The reference appears in the release changelog through the existing publish path.
5. Open Design (with the existing move-back confirmation for apps at Deploy), run Test, then publish through the existing release gates. Saving a candidate does not modify prod_snapshot or withdraw the live release.
6. Return to Eval to verify the issue after checking the released fix.

The screen groups the candidate and comparison, shows feedback/version/generation/save errors, and collapses optional GitHub tracking. Input/prompt/version changes clear old comparisons and abort pending streams; app switches cancel work and reset candidate state. Version reads reject late results from a previous app. No new SQL migration is required for these changes.

## Remaining work

Monitor and Eval: hosted API/site restart, persistence, load and operational deployment verification. Local API plus hosted staging database verification is documented separately, including independent customer/editor lifecycle tests and queue replay.

Improve: unsaved candidate recovery/exit protection; broader failure/cancellation and provider comparison checks; stronger persisted comparison/decision history beyond the accepted draft change reference. This is why Improve is not scored 95%. Optional GitHub connection is not counted as a core readiness requirement.

All three: no hosted application exists yet. OpenAI credentials currently report exhausted credits; the independent real-model lifecycle passed with Anthropic. Neither provider billing changes nor hosting deployment were performed.

## Update — review fixes (October 19, 2026)

- Unsaved candidates are kept on this browser and offered back ("Restore your unsaved candidate?") after a reload, crash or leaving Improve. Leaving Improve or switching apps with unsaved edits asks first. A save elsewhere (Design or a teammate) no longer replaces your edits; a notice appears instead.
- "Save candidate" checks against the prompt the candidate started from: a newer saved prompt is a conflict ("Load the saved prompt" / "Save mine anyway"), never silently overwritten.
- The saved improvement links the customer feedback selected in Eval (`source_feedback_id`, `source_run_id`).
- Comparison history (`app_comparisons`, migration `20261019060000`): every run where both versions answered the same input is saved for the app's editors, with "Use this input again", "Save input as a test" and "Delete". Version choices are kept when the app's details refresh.
- The prompt diff follows the light/dark theme; error messages use the dark palette.
