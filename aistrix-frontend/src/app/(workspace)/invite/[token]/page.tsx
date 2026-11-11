import { makeStandalonePage } from '../../../../server/workspacePage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Join Workspace | Aistrix' }
export default makeStandalonePage('invite', ["invite", ":token"])
