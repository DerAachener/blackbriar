import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Mit `vite --mode <name>` und API_TARGET in .env.<name> spricht die Oberfläche mit einer anderen Installation
  const target = loadEnv(mode, process.cwd(), '').API_TARGET || 'http://localhost:8787'
  return {
    root: 'web',
    plugins: [react(), tailwindcss()],
    server: {
      proxy: { '/api': target },
    },
  }
})
