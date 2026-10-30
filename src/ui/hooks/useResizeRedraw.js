/**
 * @fileoverview Обработка изменения размера окна терминала с перерисовкой экрана
 */

import { useEffect } from 'react';

export const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';
const RESIZE_DEBOUNCE_MS = 150;

/**
 * Хук подписки на изменение размера терминала с перерисовкой истории
 *
 * @param {Function} setStaticKey - Сеттер ключа перерисовки Transcript
 */
export function useResizeRedraw(setStaticKey) {
  // Терминал переносит строки при смене ширины, и Ink стирает прошлый кадр по устаревшему
  // числу строк, оставляя копии поля ввода. Поэтому экран очищается сразу, до отрисовки Ink,
  // а когда ресайз закончился, история печатается заново под новую ширину.
  useEffect(() => {
    let columns = process.stdout.columns;
    let timer = null;

    const onResize = () => {
      if (process.stdout.columns === columns) return;
      columns = process.stdout.columns;
      process.stdout.write(CLEAR_SCREEN);
      clearTimeout(timer);
      timer = setTimeout(() => {
        process.stdout.write(CLEAR_SCREEN);
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
