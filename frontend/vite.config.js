import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
const p = f => fileURLToPath(new URL(f, import.meta.url));
export default defineConfig({
  build: { rollupOptions: { input: { main: p('index.html'), dashboard: p('dashboard.html'), status: p('status.html'), about: p('about.html'), admin: p('admin.html'), auth: p('auth.html'), profile: p('profile.html'), reviews: p('reviews.html'), verify: p('verify.html'), reset: p('reset.html') } } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000', '/uploads': 'http://localhost:3000' } }
});
