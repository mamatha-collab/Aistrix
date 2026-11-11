import { makeWorkspacePage, workspaceMetadata } from '../../../server/workspacePage'

export const dynamic = 'force-dynamic'
export const metadata = workspaceMetadata('/data-sources')
export default makeWorkspacePage('/data-sources')
