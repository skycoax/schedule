// Экран запуска (#boot в index.html) убираем, когда на экране уже есть что показать:
// расписание, список вузов или ошибка. Так в приложении из Play заставка Android
// переходит в крутящееся кольцо и дальше в расписание — без пустого кадра посередине.
let done = false;

export function hideBoot(): void {
  if (done) return;
  done = true;
  const el = document.getElementById('boot');
  if (!el) return;
  // Даём кадр на отрисовку содержимого под экраном запуска, иначе увидим пустоту.
  requestAnimationFrame(() => {
    el.classList.add('is-done');
    setTimeout(() => el.remove(), 400);
  });
}

// Страховка: что бы ни случилось с данными, экран запуска не висит вечно.
setTimeout(hideBoot, 8000);
