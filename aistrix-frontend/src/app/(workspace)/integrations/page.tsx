import { makeWorkspacePage, workspaceMetadata } from '../../../server/workspacePage'

export const dynamic = 'force-dynamic'
export const metadata = workspaceMetadata('/integrations')
export default makeWorkspacePage('/integrations')
