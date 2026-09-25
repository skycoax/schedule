import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { brand } from './brand';
import { initUni } from './lib/uni';
import { UniversityStart } from './components/UniversityStart';
import './index.css';

// Работа без интернета (public/sw.js). В разработке не регистрируем — мешает правкам.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

// В Para сначала выбирают вуз, потом всё как обычно.
if (initUni()) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {brand.hub && !brand.id ? <UniversityStart /> : <App />}
    </StrictMode>,
  );
}
