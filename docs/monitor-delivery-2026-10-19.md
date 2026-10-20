# Monitor delivery — 19 October 2026

Monitor answers whether production apps are working and what needs attention. Build authoring, evaluation workflows, release changes and financial accounting remain in their respective modules.

## Delivered

- All-app and single-app views; rolling 24-hour, 7-day and 30-day periods.
- Four summaries: runs, failure rate, median/p95 response time and recorded AI cost with cost coverage. Missing observations are not shown as zero cost or zero latency.
- Overview metrics calculated from pooled, permission-approved run samples, rather than averaged app percentiles.
- Sample-qualified failure, latency, customer-rating and current-release regression alerts. Three alerts shown initially, with expansion for more.
- Daily successful/failed activity, per-app traffic sources, failure categories and release breakdowns.
- Contextual links to Eval and Version, with app selection preserved. Customer ratings described as a signal rather than an automated quality score.
- Manual refresh and 60-second refresh while visible; refresh on returning to the tab. Failed refresh retains explicitly marked stale data. Scope/period changes clear previous results and abort obsolete requests.
- Shared phone monitoring view, compact app cards and no horizontal overflow at tested phone widths. Existing Apps, Feedback and Manage destinations retained.
- Explicit empty/error states, partial-data notices, 50-app overview limit and UTC boundary explanations. Monitoring returns aggregates without customer inputs or outputs.

## Verification

- Production frontend build passed.
- Frontend unit suite: 227 tests passed.
- Backend check suite: 16 checks passed, including Monitor authorization, aggregate privacy, rolling chart boundaries, recorded-cost coverage and rollback-aware alerts.
- Browser checks cover desktop Monitor, phone/tablet layouts, error recovery, visibility-aware polling, scope switching and the feedback-to-improvement workflow.
- Live localhost Monitor reviewed with the signed-in account; screenshot: `verification/monitor-live.png`.

## Release limits

This is local implementation and verification, not a production deployment or load-test sign-off. Publish the matching frontend/backend together. No database migration is required for these changes.

Overview is bounded to 50 requested apps and per-app row limits; reached limits are disclosed. Recorded cost depends on upstream telemetry. Email notifications, custom alert thresholds and streaming updates are outside this Monitor MVP. Production soak/load verification remains necessary before claiming production approval.
