// Shared helper for parsing Server-Sent-Event lines coming back from the
// backend's streaming /run endpoint.
//
// Previously this exact "skip non-data lines, try/catch JSON.parse" block was
// copy-pasted in ~13 different components (AppRunner, AgentRunner, ApiAppRunner,
// DataAppRunner, ReportsPage, FlowsPage, MultiPageRunner, ConversationThread,
// CreateAppModal, CreateFromWebsiteModal, KnowledgeBaseEditor, DataSourcesPage,
// AIAppBuilder). A few of those call sites also relied on a fragile trick —
// checking whether a caught error's message was literally the V8 string
// "Unexpected end of JSON input" — to tell a genuine backend error (thrown via
// `if (data.error) throw ...`) apart from an incomplete JSON parse. Centralizing
// the parse here means callers no longer need that trick: a parse failure just
// returns null, and any `data.error` handling downstream is a normal condition
// check instead of being entangled with try/catch control flow.
export function parseSSELine(line) {
  if (!line.startsWith('data: ')) return null
  try {
    return JSON.parse(line.slice(6))
  } catch {
    return null
  }
}
