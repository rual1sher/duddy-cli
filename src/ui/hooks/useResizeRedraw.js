/**
 * @fileoverview Обработка изменения размера окна терминала с перерисовкой экрана
 */

import { useEffect } from 'react';

export const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';
const RESIZE_DEBOUNCE_MS = 150;

/**
 * Очищает экран и буфер прокрутки, затем перемещает курсор в начало последней строки терминала
 *
 * @returns {string}
 */
export function clearScreenToBottom() {
  return CLEAR_SCREEN + `\x1b[${process.stdout.rows || 24};1H`;
}

/**
 * Прокручивает предыдущий вывод оболочки в scrollback и оставляет курсор на последней строке
 *
 * @returns {string}
 */
export function pushToBottom() {
  return '\n'.repeat(Math.max(0, (process.stdout.rows || 24) - 1));
}

/**
 * Хук подписки на изменение размера терминала с перерисовкой истории
 *
 * @param {Function} setStaticKey - Сеттер ключа перерисовки Transcript
 */
export function useResizeRedraw(setStaticKey) {
  // Терминал переносит строки при смене ширины, и Ink стирает прошлый кадр по устаревшему
  // числу строк, оставляя копии поля ввода. Поэтому экран очищается сразу, а курсор переносится
  // на последнюю строку терминала, чтобы поле ввода оставалось внизу. Когда ресайз закончился,
  // история печатается заново под новую ширину.
  useEffect(() => {
    let columns = process.stdout.columns;
    let timer = null;

    const onResize = () => {
      if (process.stdout.columns === columns) return;
      columns = process.stdout.columns;
      process.stdout.write(clearScreenToBottom());
      clearTimeout(timer);
      timer = setTimeout(() => {
        process.stdout.write(clearScreenToBottom());
        setStaticKey(k => k + 1);
      }, RESIZE_DEBOUNCE_MS);
    };

    // Ink подписывается раньше, а очистка должна пройти до его отрисовки
    process.stdout.prependListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      process.stdout.off('resize', onResize);
    };
  }, [setStaticKey]);
}
