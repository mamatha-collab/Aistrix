// Facts the Terms and Privacy Policy depend on. Until they're filled in, the
// pages show the bracketed placeholders, so an unfinished draft is obvious.
// Have the final text reviewed by a lawyer before a public launch.
export const LEGAL = {
  company: import.meta.env.VITE_LEGAL_COMPANY || '[Company legal name]',
  address: import.meta.env.VITE_LEGAL_ADDRESS || '[Registered business address]',
  jurisdiction: import.meta.env.VITE_LEGAL_JURISDICTION || '[Country / state whose law applies]',
  dataRegion: import.meta.env.VITE_LEGAL_DATA_REGION || '[Region where the database is hosted]',
  minimumAge: import.meta.env.VITE_LEGAL_MINIMUM_AGE || '16',
  updated: '2026-10-20',
}
