// The whole conversation is sent as the run input, which the backend caps at
// 20k characters — keep the most recent turns that fit.
export const HISTORY_CHAR_BUDGET = 14000

export function buildConversationInput(greeting, history, userMsg) {
  const turns = []
  let used = userMsg.length
  for (let i = history.length - 1; i >= 0; i--) {
    const line = `${history[i].role === 'user' ? 'User' : 'Assistant'}: ${history[i].content}`
    if (used + line.length > HISTORY_CHAR_BUDGET) break
    turns.unshift(line)
    used += line.length
  }
  if (greeting && turns.length === history.length && used + greeting.length < HISTORY_CHAR_BUDGET) {
    turns.unshift(`Assistant: ${greeting}`)
  }
  return turns.length
    ? `Conversation history:\n${turns.join('\n\n')}\n\nUser: ${userMsg}`
    : userMsg
}
