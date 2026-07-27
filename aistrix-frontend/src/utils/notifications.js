import { supabase } from '../supabase'

// Pulled out of components/NotificationsPanel.jsx: that file exported both
// the NotificationsPanel component and this function, which breaks Vite Fast
// Refresh (oxlint's react/only-export-components warning). AppRunner.jsx
// (itself lazy-loaded) only needs this one function, not the whole panel UI —
// keeping it here also avoids pulling NotificationsPanel's component code
// into AppRunner's chunk.
export async function createNotification(userId, { type, title, message, link_view }) {
  if (!userId) return
  await supabase.from('notifications').insert({ user_id: userId, type, title, message, link_view })
}
