# Business and Marketplace console correction

The migration had put public discovery under a minimal public navigation header.
That removed the Business/Developer console frame and rendered a static Sign in
link even for signed-in users. Business mode also was not selected when entering
private Business routes from that header, allowing a remembered Developer mode
to take the user back to Dev Studio.

Marketplace, listing details and public developer profiles now use the same
DeveloperShell, sidebar, mode switch and account chrome as Business. Discovery
remains public and server rendered from explicitly anonymous catalog reads.
Account controls follow the real browser session; signed-in users see their
account, workspace and permitted staff actions. Guests can browse without
authentication. Private workspace links still require sign-in, with a Browse
Marketplace link on the sign-in screen to return to discovery.

Marketplace navigation explicitly selects Business mode before opening My apps,
Workflows or other Business sections. Developer mode switches use the existing
Dev Studio route. Existing workspace switching, key settings and management
controls are reused, with no backend authorization changes.

The catalog has calmer card surfaces, clear result counts and explanatory copy,
and a single card column on small phones. Details/profiles scroll inside the
console. Responsive shell detection uses a server snapshot to avoid mismatched
desktop/mobile markup during hydration. No hosted schema or account changes were
made.

Verification: 365 unit/database tests and 36 native desktop/mobile route checks
passed. Ten targeted Business/Developer component journeys passed, with two
platform-specific cases skipped. Final focused console/SSR checks were rerun
after the staff-navigation and small-phone refinements. The user's running
signed-in browser was also checked from Marketplace to My apps and back: it
retained the account and returned to the catalog without a sign-in form.
