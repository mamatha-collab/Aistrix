# Business client UI refresh — October 22, 2026

Business now shares Developer's restrained purple palette, neutral surfaces, compact controls and light/dark appearance. The changes are scoped to the client shell; existing app execution, billing and workspace authorization remain in their existing services.

- Apps, Workflows and Marketplace are the primary client destinations. Activity, knowledge, data sources, integrations, profiles, settings and reports remain accessible.
- Compact header with shared search for Apps/Workflows, triangle Runs action, notifications, workspace switching and an avatar account menu. Account menu closes on outside click/Escape and retains personal keys, theme, settings and sign-out confirmation. Client app authoring shortcuts lead to Developer instead of opening app creation in Business.
- Aligned desktop brand/header and mode/context rows; responsive header and existing mobile bottom navigation. No sidebar allowance meter or repeated account toolbar.
- Published app browsing, favorites-backed Saved apps, published Shared apps and search across client libraries. Client cards emphasize purpose/access and Open app; internal model/type/readiness metadata and publication controls are omitted from those cards.
- Existing workflow execution, creation, templates, sharing, scheduling and webhook interfaces remain. New heading and primary action; templates/recommendations sit behind an expandable section. Workflow search integrates with the header.
- Supporting Business pages inherit the same surface, text, input, tab and action treatment. API errors have visible retry paths in the app/workflow libraries.
- This UI work does not add a new permission model for distributing Developer-authored workflows to end users, and does not claim new execution features. Existing workflow access restrictions remain unchanged.

Verification: production build and lint passed (existing unrelated warnings remain); 282 frontend/database tests passed; 18 browser journeys passed across Business, Developer layout and Marketplace (8 intentional viewport skips). The four Business checks were rerun after final search/card cleanup and passed. Synthetic desktop/mobile previews are saved beside this document under verification/business-apps-preview.png and verification/business-workflows-mobile-preview.png. They are fixture screens, not live client data.


## Marketplace-first follow-up

Business now opens Marketplace by default and when switching from Developer. Explicit bookmarked routes remain supported. Marketplace is first in the ribbon and mobile navigation. My apps is the saved/shared library; its duplicate Discover catalog is removed in client mode, and its app query is limited to favorites. Marketplace cards provide a retryable Save app action using existing favorites permissions; the library and left pane refresh after changes. Publishing and listing remain separate. Developer-workflow marketplace distribution is not introduced by this UI change.

Validation: production build and lint passed (existing warnings); 12 existing Marketplace browser checks and 4 Business desktop/mobile checks passed.
