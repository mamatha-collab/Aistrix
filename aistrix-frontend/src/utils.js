export function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export const PLACEHOLDERS = {
  1: "e.g. Our bounce rate increased 20% last month. What should I investigate?",
  2: "e.g. Write a blog post about the benefits of AI in e-commerce",
  3: "e.g. My homepage is ranking on page 2 for 'project management software'",
  4: "e.g. Re-engagement campaign for users who haven't logged in for 30 days",
  5: "e.g. How do I reset my password?",
  6: "e.g. SaaS companies with 10-50 employees in the US using Salesforce",
  7: "e.g. 1000 visitors → 300 signups → 80 trials → 12 paid. Where should I focus?",
  8: "e.g. Sales were steady at $50k/month then dropped to $12k in week 3. Normal pattern resumed week 5.",
}
