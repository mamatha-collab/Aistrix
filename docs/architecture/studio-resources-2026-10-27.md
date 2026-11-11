# Studio resource inspection

## Developer workspace entry point

### Page arrangement revision — November 10, 2026

The later [workspace capability review](workspace-information-architecture.md) consolidates the catalog into eight working areas, gives Agent creation one home, separates AI-assisted setup from app formats, embeds real provider controls in Models, and lists unbuilt capabilities as planned. It supersedes the thirteen-entry navigation arrangement described in the historical notes below.

Developer Workspace is the main landing page. Selecting a capability opens its own detail page rather than leaving the full capability grid above its content. All capabilities returns to the landing chooser. Workspace navigation remains available alongside app-specific navigation on desktop; mobile retains the workspace entry point and the same capability selection.

AI Apps contains actionable application-type cards. Selecting a type opens that type's builder directly, including the existing provider-key gate where required. The old second "Create an AI app" picker is no longer inserted in the Developer flow. Cancelling or backing out returns to the selected capability; creating an app still opens its correct lifecycle stage. Unsaved-edit navigation protection is retained.

The global Create action opens the workspace capability chooser. App-specific New AI App actions open AI Apps, and the persistent AI Apps shortcut leads to that type-selection page. Resources, Evaluations and Workflows use workspace page headings; pipeline Resources/Evaluations and Workflows are removed from the app lifecycle ribbon. App Design/Test/Deploy and app operations remain subordinate app tools. The return action is named Back to workspace.

Verification for this revision: production webpack build passed; 268 frontend unit tests passed; targeted lint passed with the existing DevStudioPage dependency warning. The complete 52-test desktop/mobile browser suite passed before the final capability-detail refinement; all 14 affected workspace, direct-builder, Studio, resource and evaluation browser checks passed again against the final build. Desktop and mobile screenshots were inspected. Browser services are synthetic, and this UI revision does not deploy backend changes.

The Developer landing page now starts with a capability chooser matching the architecture catalog, with an AI Apps entry for existing application types: AI Apps, Models, Agents, Nodes, Tools, MCP, Workflows, Knowledge, Data, Prompts, Evaluations, Interfaces, and Operations. Selecting a capability reveals its available tasks and implementation limits. Actions open existing Studio tools, resource inspection, provider settings, or connected workspace pages. Nodes reads the real built-in catalog from `/v1/platform/nodes`; managed MCP hosting is marked planned. Application editing remains available through the application Studio shortcut. The logo and Workspace navigation return to the chooser on desktop and mobile; Studio tools and the app creation flow have a visible Back to types action on desktop and mobile, using the existing unsaved-change guard. AI Apps lists the shared application type catalog and opens the existing type picker.

Verification for the chooser: production webpack build passed; lint passed with repository warnings; six desktop/mobile browser tests passed covering all thirteen choices, node catalog, MCP availability, workflow navigation, return home, and platform resource inspection. Desktop and mobile screenshots were inspected. Browser fixtures verify UI behavior rather than deployed backend capability.

The architecture revision calls for a minimal Studio view of the same releases and runs exposed through the Platform API and CLI. The Developer workspace now includes Resources on desktop and mobile, independently of legacy app creation.

The view uses authenticated `/v1/platform` endpoints to list resources, inspect immutable release IDs and content hashes, show environment version pointers, read evaluation results, and inspect recent runs, step state, model cost, budget, errors, and recorded events. Refresh reloads server state. Resource selection changes discard the previous resource's run and evaluation selection. Failed requests show errors with a Refresh action.

This increment provides inspection, not a full browser IDE. Release authoring, promotion, rollback, invocation, and approvals continue through the existing API, CLI, and SDK. Capabilities absent from the backend are not advertised as implemented. The existing application and marketplace routes remain available for compatibility.

Verification: `npm test -- --maxWorkers=1 --reporter=dot` with TEMP and TMP pointing to the workspace cache: 45 test files, 390 tests passed. `npm run lint` passed with existing repository warnings. The production build with webpack passed outside the sandbox using local fixture service settings. `npx playwright test --config playwright.next.config.js --grep 'platform resources'`: desktop and mobile passed (2 tests); screenshots were inspected. The desktop navigation was widened after inspection to accommodate the fourth Manage item. Browser tests use synthetic data and do not prove deployed platform acceptance.
