import { makeStandalonePage } from '../../../../server/workspacePage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Embedded App | Aistrix' }
export default makeStandalonePage('embed', ["embed", ":id"])
