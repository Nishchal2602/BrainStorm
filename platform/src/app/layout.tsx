import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Pocket PM',
  description: 'AI-native Product Operating System',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  )
}
