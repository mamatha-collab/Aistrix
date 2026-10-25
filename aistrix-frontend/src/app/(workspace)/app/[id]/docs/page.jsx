import { makeStandalonePage } from '../../../../../server/workspacePage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'App Documentation | Aistrix' }
export default makeStandalonePage('docs', ["app", ":id", "docs"])
