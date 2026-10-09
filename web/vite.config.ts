import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { allowedHosts: true },
  // локальный стенд: API/MCP — uvicorn на :8106 (в проде их проксирует nginx)
  preview: { allowedHosts: true, proxy: { '/api': 'http://127.0.0.1:8106', '/mcp': 'http://127.0.0.1:8106' } },
})
