import { makeStandalonePage } from '../../../../server/workspacePage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'App | Aistrix' }
export default makeStandalonePage('app', ["app", ":id"])
