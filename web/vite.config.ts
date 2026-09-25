import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Орбита на экране запуска (src/boot-orb.ts) — отдельной точкой входа. Скрипты из index.html Vite склеивает
 * в один файл, и тогда орбита ждала бы всё приложение. Здесь она собирается отдельно, а её тег ставится
 * на место <!--boot-orb--> перед основным скриптом: маленький файл грузится и начинает крутиться первым.
 */
function bootOrb(): Plugin {
  return {
    name: 'boot-orb',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html.replace('<!--boot-orb-->', '<script type="module" async src="/src/boot-orb.ts"></script>');
        const chunk = Object.values(ctx.bundle).find((c) => c.type === 'chunk' && c.isEntry && c.name === 'boot');
        if (!chunk || chunk.type !== 'chunk') throw new Error('boot-orb: нет файла орбиты в сборке');
        // async — не ждать основной файл (обычные module-скрипты выполняются по порядку); тег стоит после
        // #boot, поэтому элемент уже есть. modulepreload — орб (общий с PullRefresh) качается сразу, параллельно.
        const pre = chunk.imports.map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`).join('');
        return html.replace('<!--boot-orb-->', `${pre}<script type="module" async crossorigin src="/${chunk.fileName}"></script>`);
      },
    },
  };
}

// Сборка одна на все вузы: название, мета-теги, манифест и картинки бренда
// подставляет сервер (server/src/site.js) по адресу, на который пришёл запрос.
// В разработке фронт на :5173, сервер на :8792 — проксируем к нему всё серверное.
export default defineConfig({
  plugins: [react(), bootOrb()],
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        boot: fileURLToPath(new URL('./src/boot-orb.ts', import.meta.url)),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8792',
      '/brand': 'http://127.0.0.1:8792',
      '/brand-of': 'http://127.0.0.1:8792',
      '/manifest.json': 'http://127.0.0.1:8792',
    },
  },
});
