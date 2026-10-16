// Agent tool types offered in the Tools editor and used by Build with AI.
// defaultSchema is the parameter schema the model sees for each tool.
export const TOOL_TYPES = [
  {
    id: 'search',
    icon: '🔍',
    label: 'Web Search',
    desc: 'Search the web for current information. AI decides what to search.',
    configFields: [],
    defaultSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
  },
  {
    id: 'fetch',
    icon: '🌐',
    label: 'Fetch URL',
    desc: 'Retrieve content from any webpage. AI decides which URL to fetch.',
    configFields: [],
    defaultSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The URL to fetch' } },
      required: ['url'],
    },
  },
  {
    id: 'calculator',
    icon: '🧮',
    label: 'Calculator',
    desc: 'Evaluate math expressions. AI uses this for accurate calculations.',
    configFields: [],
    defaultSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'Math expression to evaluate, e.g. "2 * (3 + 4)"' } },
      required: ['expression'],
    },
  },
  {
    id: 'http',
    icon: '🔗',
    label: 'HTTP Request',
    desc: 'Call any external API. You configure the endpoint; AI sends the data.',
    configFields: [
      { key: 'url', label: 'Endpoint URL', placeholder: 'https://api.example.com/endpoint' },
      { key: 'method', label: 'Method', placeholder: 'POST', options: ['GET', 'POST', 'PUT'] },
      { key: 'headers', label: 'Headers (JSON) — reference secrets as {{secrets.KEY}}, never paste raw keys', placeholder: '{"Authorization": "Bearer {{secrets.MY_API_KEY}}"}' },
    ],
    defaultSchema: {
      type: 'object',
      properties: { data: { type: 'string', description: 'Data to send to the API' } },
      required: [],
    },
  },
  {
    id: 'app',
    icon: '🧩',
    label: 'Call Aistrix App',
    desc: 'Chain to another Aistrix app. The AI can invoke it mid-conversation.',
    configFields: [
      { key: 'app_id', label: 'Target App ID', placeholder: 'UUID of the app to call' },
    ],
    defaultSchema: {
      type: 'object',
      properties: { input: { type: 'string', description: 'Input to send to the app' } },
      required: ['input'],
    },
  },
]

export const TOOL_DEFAULT_SCHEMAS = Object.fromEntries(TOOL_TYPES.map(t => [t.id, t.defaultSchema]))
