/**
 * @fileoverview Обработка изменения размера окна терминала с перерисовкой экрана
 */

import { useEffect } from 'react';
import { useStdout } from 'ink';

export const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';
const RESIZE_DEBOUNCE_MS = 150;

/**
 * Очищает экран и буфер прокрутки, затем перемещает курсор в начало экрана (1;1)
 *
 * @returns {string}
 */
export function clearScreenToTop() {
  return CLEAR_SCREEN;
}

/**
 * Сдвигает предыдущий вывод оболочки в scrollback и ставит курсор в начало экрана
 *
 * @returns {string}
 */
export function startAtTop() {
  const rows = process.stdout.rows || 24;
  return '\n'.repeat(Math.max(0, rows - 1)) + '\x1b[H\x1b[2J';
}

/**
 * Хук подписки на изменение размера терминала с перерисовкой истории
 *
 * @param {Function} setStaticKey - Сеттер ключа перерисовки Transcript
 */
export function useResizeRedraw(setStaticKey) {
  const { write } = useStdout();
  // Терминал переносит строки при смене ширины, и Ink стирает прошлый кадр по устаревшему
  // числу строк, оставляя артефакты. Поэтому экран очищается сразу, а курсор переносится
  // в начало экрана. Когда ресайз закончился, экран очищается через Ink, который сам
  // перерисовывает последний кадр (иначе неизменившийся кадр не перерисуется и экран
  // останется пустым), и история печатается заново под новую ширину.
  useEffect(() => {
    let columns = process.stdout.columns;
    let timer = null;

    const onResize = () => {
      if (process.stdout.columns === columns) return;
      columns = process.stdout.columns;
      process.stdout.write(clearScreenToTop());
      clearTimeout(timer);
      timer = setTimeout(() => {
        write(clearScreenToTop());
        setStaticKey(k => k + 1);
      }, RESIZE_DEBOUNCE_MS);
    };

    // Ink подписывается раньше, а очистка должна пройти до его отрисовки
    process.stdout.prependListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      process.stdout.off('resize', onResize);
    };
  }, [setStaticKey, write]);
}
