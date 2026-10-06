import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // HTTPS (self-signed) because phones only hand out the motion sensors on secure origins
  plugins: [react(), basicSsl()],
  server: { host: true },
})
