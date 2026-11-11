import { makeWorkspacePage, workspaceMetadata } from '../../../server/workspacePage'

export const dynamic = 'force-dynamic'
export const metadata = workspaceMetadata('/analytics')
export default makeWorkspacePage('/analytics')
