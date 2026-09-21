import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Сборка одна на все вузы: название, мета-теги, манифест и картинки бренда
// подставляет сервер (server/src/site.js) по адресу, на который пришёл запрос.
// В разработке фронт на :5173, сервер на :8792 — проксируем к нему всё серверное.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8792',
      '/brand': 'http://127.0.0.1:8792',
      '/brand-of': 'http://127.0.0.1:8792',
      '/manifest.json': 'http://127.0.0.1:8792',
    },
  },
});
