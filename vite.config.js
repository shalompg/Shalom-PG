import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Security headers for the built site. GitHub Pages can't send custom HTTP headers,
 * so the Content-Security-Policy and Referrer-Policy go in <meta> tags instead.
 * Only applied to production builds (the dev server needs inline scripts for hot reload).
 */
function securityMeta(supabaseUrl) {
  const sb = supabaseUrl ? new URL(supabaseUrl).origin : ''
  const ws = sb.replace(/^https:/, 'wss:')
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // inline styles are needed for animations
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${sb}`,
    `connect-src 'self' data: blob: ${sb} ${ws}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
  return {
    name: 'security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    // './' lets the built site work from any sub-folder, e.g. https://<you>.github.io/Shalom-PG/
    base: './',
    plugins: [react(), securityMeta(env.VITE_SUPABASE_URL)],
    build: { sourcemap: false },
  }
})
