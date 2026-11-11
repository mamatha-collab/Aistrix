import { makeWorkspacePage, workspaceMetadata } from '../../../server/workspacePage'

export const dynamic = 'force-dynamic'
export const metadata = workspaceMetadata('/settings')
export default makeWorkspacePage('/settings')
