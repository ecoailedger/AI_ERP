import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Ports can be moved with environment variables, to run a second copy beside the first.
const clientPort = Number(process.env.AI_ERP_CLIENT_PORT ?? 5190);
const apiPort = Number(process.env.PORT ?? 5191);

export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
