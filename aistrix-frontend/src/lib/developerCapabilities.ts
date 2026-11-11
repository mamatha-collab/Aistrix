import type { LucideIcon } from 'lucide-react'
import type { CapabilityId, DeveloperAction } from '../types/domain'
import { Activity, Bot, BrainCircuit, Braces, Database, FlaskConical, LayoutGrid, Waypoints } from 'lucide-react'

interface Capability {
  id: CapabilityId
  label: string
  Icon: LucideIcon
  description: string
  detail: string
  actions?: [string, DeveloperAction][]
  links?: [string, string][]
  planned?: boolean
}
export const developerCapabilities: Capability[] = [
  { id: 'ai-apps', label: 'AI Apps', Icon: LayoutGrid, description: 'Build user-facing AI applications.', detail: 'Choose how to start, then select an application format. Prompts, model selection, API access, embedding, and publishing belong to the app you are editing.', actions: [['Manage AI apps', 'design']] },
  { id: 'models', label: 'Models & Providers', Icon: BrainCircuit, description: 'Connect providers and inspect their available models.', detail: 'Manage provider connections below. Select the actual model in an app or pipeline. Model hosting, fine-tuning, and independent Model resources are planned.' },
  { id: 'agents', label: 'Agents', Icon: Bot, description: 'Build goal-driven assistants that use tools.', detail: 'Create and manage the existing agent application type here. Standalone versioned Agent resources, persistent platform sessions, and richer memory are planned.', actions: [['Create an agent', 'create:agent']] },
  { id: 'workflows', label: 'Workflows', Icon: Waypoints, description: 'Connect applications, actions, and approvals.', detail: 'Compose existing apps in the workflow designer, or inspect released Application pipelines in the registry.', actions: [['Open workflow designer', 'workflows'], ['Inspect pipeline releases', 'resources']] },
  { id: 'nodes', label: 'Code & Tools', Icon: Braces, description: 'Develop Python jobs and connect callable tools.', detail: 'Create a private Python job, inspect built-in node contracts, or connect external services. Python jobs are currently code applications; publishing them as reusable Node/Tool resources is planned.', actions: [['Create Python resource with AI', 'create-code']], links: [['Open integrations', '/integrations']] },
  { id: 'knowledge', label: 'Knowledge & Data', Icon: Database, description: 'Manage reference material, data connections, and datasets.', detail: 'Use the existing knowledge vault and data connections, or inspect immutable Dataset releases. Managed indexing, Knowledge Base resources, ingestion, and lineage are planned.', actions: [['Inspect dataset releases', 'resources']], links: [['Open knowledge vault', '/knowledge-vault'], ['Open data sources', '/data-sources']] },
  { id: 'evaluations', label: 'Evaluations', Icon: FlaskConical, description: 'Test releases and compare recorded results.', detail: 'Author pipeline evaluation suites, inspect case failures, compare results, and review promotion requirements. Existing app tests and feedback remain in the app lifecycle.', actions: [['Open Evaluations', 'evaluations'], ['Test applications', 'test'], ['Review application quality', 'evaluate']] },
  { id: 'operations', label: 'Operations', Icon: Activity, description: 'Monitor runs and manage releases, deployment, and secrets.', detail: 'Inspect execution and costs, review immutable releases, and manage app deployment and secrets. General source hosting is planned.', actions: [['Monitor applications', 'monitor'], ['Inspect platform runs', 'resources'], ['Deploy applications', 'deploy'], ['Manage secrets', 'secrets']] },
]

export const developerCapabilityLabel = (id: CapabilityId | null | undefined) => developerCapabilities.find(item => item.id === id)?.label
