// Хранилище настроек: пишем и в localStorage, и в куку, читаем из любого.
// Кука живёт год и переживает запуск с главного экрана.

export function ls(k: string, v?: string): string | null {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch { /* приватный режим и т.п. */ }
  return null;
}

export function ck(k: string, v?: string): string | null {
  try {
    if (v === undefined) {
      const m = document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    }
    document.cookie = k + '=' + encodeURIComponent(v) + ';path=/;max-age=31536000;samesite=lax';
  } catch { /* куки выключены */ }
  return null;
}

export function store(k: string, v?: string): string | null {
  if (v === undefined) return ls(k) || ck(k);
  ls(k, v); ck(k, v);
  return null;
}
