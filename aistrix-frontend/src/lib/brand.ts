// The product's name and domain, in one place. A rename (e.g. if the name
// can't be trademarked) is NEXT_PUBLIC_BRAND_NAME / NEXT_PUBLIC_BRAND_DOMAIN at build time,
// or these two defaults. The backend has the same pair (BRAND_NAME /
// BRAND_DOMAIN). Internal identifiers (storage keys, the SDK package) don't
// change with the brand.
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || 'Aistrix'
export const BRAND_DOMAIN = process.env.NEXT_PUBLIC_BRAND_DOMAIN || 'aistrix.ai'
export const BRAND_URL = `https://${BRAND_DOMAIN}`
export const SUPPORT_EMAIL = `support@${BRAND_DOMAIN}`
