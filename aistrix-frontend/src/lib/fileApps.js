// App types that run on files rather than a typed request: Data (PDF, Word,
// Excel, CSV, URL), Vision (images) and Voice (recordings). They share the
// file runner (components/DataAppRunner).
export const FILE_APP_TYPES = ['data', 'vision', 'voice']
export const isFileApp = app => FILE_APP_TYPES.includes(app?.app_type)
