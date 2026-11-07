import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

// Refuse to run inside another site's frame (protects against "clickjacking" tricks).
if (window.top !== window.self) {
  document.body.textContent = 'Open Shalom PG directly in your browser.'
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
