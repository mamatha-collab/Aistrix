import { makeWorkspacePage, workspaceMetadata } from '../../../server/workspacePage'

export const dynamic = 'force-dynamic'
export const metadata = workspaceMetadata('/dashboard')
export default makeWorkspacePage('/dashboard')
