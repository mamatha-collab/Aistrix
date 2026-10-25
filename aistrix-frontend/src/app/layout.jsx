import '../index.css'

export const metadata = {
  metadataBase: new URL(`https://${process.env.NEXT_PUBLIC_BRAND_DOMAIN || 'aistrix.ai'}`),
  title: process.env.NEXT_PUBLIC_BRAND_NAME || 'Aistrix',
  description: 'Discover AI tools and build workflows with Aistrix.',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  )
}
