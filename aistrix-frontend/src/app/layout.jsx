import { cookies } from 'next/headers'
import '../index.css'
import { THEME_COOKIE, themeHead } from '../utils/theme'

export const metadata = {
  metadataBase: new URL(`https://${process.env.NEXT_PUBLIC_BRAND_DOMAIN || 'aistrix.ai'}`),
  title: process.env.NEXT_PUBLIC_BRAND_NAME || 'Aistrix',
  description: 'Discover AI tools and build workflows with Aistrix.',
  icons: { icon: '/favicon.svg' },
}

export default async function RootLayout({ children }) {
  // Rendered in the saved theme so a light page never shows dark first.
  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'light' ? 'light' : 'dark'
  const styles = themeHead(theme)
  return (
    <html lang="en" data-theme={theme} style={{ colorScheme: theme }} suppressHydrationWarning>
      <head>
        <style id="aistrix-theme-vars" dangerouslySetInnerHTML={{ __html: styles.vars }} />
        <style id="aistrix-theme-overrides" dangerouslySetInnerHTML={{ __html: styles.overrides }} />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  )
}
