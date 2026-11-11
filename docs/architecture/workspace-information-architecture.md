# Developer workspace: capability review and navigation

Reviewed November 10, 2026 against the adopted architecture, current resource schemas, application type catalog and available screens. The architecture's capability catalog is not a requirement for thirteen independent editors. This revision changes navigation and labels; existing app types, stored IDs, APIs and resource envelopes remain compatible.

## The distinction

- A working area owns a developer task: build an app, develop an agent, connect models, or inspect execution.
- A creation method helps start that task. The guided AI builder and website import are methods, not separate resources or agent runtimes.
- App formats and templates configure the existing app runtime. They should not imply a separate platform engine for every format.
- Planned resource capabilities must not look like complete studios that merely send users back to generic app Design.

## Current navigation

| Working area | Available today | Boundary |
| --- | --- | --- |
| AI Apps | AI-assisted setup, website starting material, direct app formats/templates, existing app management | Agent creation lives in Agents; Python jobs live in Code & Tools. Prompt editing, model choice, API/embedding and publishing stay with an app. |
| Agents | Create the existing agent application type; list/open saved agent apps | This is not a new standalone Agent resource or persistent platform agent-session engine. Those remain planned. |
| Workflows | Existing workflow designer and Application pipeline inspection | No duplicate agent or app builder. |
| Code & Tools | Python job development, saved Python jobs, built-in typed-node catalog and integrations | Nodes and tools describe callable capabilities. Reusable developer-authored Node/Tool registration/SDK remains planned. |
| Models & Providers | Server-reported provider/model catalog, connection status, existing key save/remove controls inside the workspace | Model selection belongs to the app/pipeline. Model resources, fine-tuning and hosting remain planned. Key storage/validation still uses existing backend endpoints. |
| Knowledge & Data | Links to the working knowledge vault, data connections, and released Dataset inspection | One navigation area, distinct underlying concepts. Indexed Knowledge Base resources, ingestion and lineage remain planned. |
| Evaluations | Versioned pipeline suites and results; links to existing app tests and feedback | Pipeline release evaluation and app feedback are distinct workflows within one quality area. |
| Operations | Monitoring, platform runs/releases, app deployment and secrets | Interfaces and triggers are app/workflow deployment configuration, not another app creator. General source hosting remains planned. |

Resource registry remains a cross-cutting supporting view, not a ninth creation category. The same eight areas appear in the desktop workspace navigation. The landing page lists unbuilt capabilities separately without fake create/run actions.

The home breadcrumb is part of the existing ribbon: “Developer workspace / AI Apps”. Its workspace label returns to the main chooser and remains outside the scrolling page body on desktop and mobile. There is no separate breadcrumb row consuming body space. Entry and return reset only the content pane's scroll position; page-wide `scrollIntoView` is avoided so navigation cannot shift the workspace shell. App editors and builders retain their guarded “Back to workspace” action.

The ribbon/alignment follow-up passed production compilation and 12 targeted desktop/mobile browser checks, including return from every area, long-page scrolling, and a geometry check that the home heading sits directly below the ribbon. Desktop home and AI Apps screenshots were inspected.

## Original catalog mapping

| Original entry | Placement and rationale |
| --- | --- |
| AI Apps | Retained; creation methods separated from app formats. |
| Models | Models & Providers, with real controls rather than a link to account settings. |
| Agents | Retained as the canonical Agent creation entry; removed the duplicate Agent tile under AI Apps. |
| Nodes + Tools | Combined as Code & Tools; current code jobs/catalog/integrations share this area. |
| MCP | Planned hosting capability; protocol hosting is distinct from a callable tool. Existing integrations are in Code & Tools. |
| Workflows | Retained. |
| Knowledge + Data | Combined navigation; vault, sources and immutable datasets remain distinct destinations. |
| Prompts | Edit within an app/pipeline today; standalone versioned prompt assets remain planned. |
| Evaluations | Retained; common entry for release suites and existing app quality tools. |
| Interfaces | App deployment/API/embed configuration and workflow triggers; hosting roadmap under Operations. |
| Operations | Retained. |

"Describe an app with AI" is the existing guided configurator. It does not create an additional class of autonomous agent. Aistrix's Python prompt-to-code Studio is a separate implementation inside the Python job editor; it currently proposes reviewable file changes rather than operating as a general autonomous terminal agent.

## Implementation and verification scope

Provider connection UI was extracted from Settings into one shared component, preserving existing credential APIs and storage behavior. The Models page reads the authenticated provider endpoint, distinguishes loading/error/empty states, and does not show fallback catalog data after a failed request. Connecting a provider refreshes the catalog's connection status without navigating away.

No resource migrations, existing-app conversions, model execution, paid sandbox runs or production deployment are part of this navigation revision. Browser acceptance uses synthetic providers/keys and verifies no real credential changes.

Verification: production webpack build passed; all 268 frontend unit tests and all 56 desktop/mobile Next.js browser tests passed. New browser coverage checks the eight working areas, removal of duplicate Agent/creation-method tiles, direct Agent creation and return, inline provider connection using a synthetic key, catalog failure/retry/empty handling, and existing Studio/evaluation/navigation regressions. Desktop and mobile Models screenshots were inspected. Targeted lint passed with the existing DevStudioPage effect-dependency warning.
