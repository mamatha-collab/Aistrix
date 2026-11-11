// Facts the Terms and Privacy Policy depend on. Until they're filled in, the
// pages show the bracketed placeholders, so an unfinished draft is obvious.
// Have the final text reviewed by a lawyer before a public launch.
export const LEGAL = {
  company: process.env.NEXT_PUBLIC_LEGAL_COMPANY || '[Company legal name]',
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || '[Registered business address]',
  jurisdiction: process.env.NEXT_PUBLIC_LEGAL_JURISDICTION || '[Country / state whose law applies]',
  dataRegion: process.env.NEXT_PUBLIC_LEGAL_DATA_REGION || '[Region where the database is hosted]',
  minimumAge: process.env.NEXT_PUBLIC_LEGAL_MINIMUM_AGE || '16',
  updated: '2026-10-20',
}
