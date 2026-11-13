/**
 * @fileoverview Описание старта вызовов инструментов и склонение числительных
 */

/**
 * Склонение существительных с числительными в русском языке
 *
 * @param {number} n - Число
 * @param {string} one - Форма для 1 (например, "строка", "элемент")
 * @param {string} few - Форма для 2-4 (например, "строки", "элемента")
 * @param {string} many - Форма для остальных (например, "строк", "элементов")
 * @returns {string} Число и правильная форма слова через пробел
 */
export function plural(n, one, few, many) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let word = many;
  if (mod10 === 1 && mod100 !== 11) {
    word = one;
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    word = few;
  }
  return `${n} ${word}`;
}

const START_TITLES = {
  read_file: 'Читает',
  list_dir: 'Смотрит папку',
  create_file: 'Записывает',
  create_folder: 'Создаёт папку',
  edit_file: 'Изменяет',
  delete_file: 'Удаляет',
  delete_folder: 'Удаляет папку',
  bash: 'Выполняет',
  grep: 'Ищет',
  glob: 'Ищет файлы'
};

/**
 * Определяет, что показать рядом с именем инструмента
 *
 * @param {string} name - Имя инструмента
 * @param {object} [args] - Аргументы вызова инструмента
 * @returns {string}
 */
export function toolTarget(name, args) {
  if (name === 'bash') return String(args?.command ?? '').split('\n')[0].slice(0, 100);
  if (name === 'grep' || name === 'glob') return args?.pattern ?? '';
  if (name === 'list_dir') return args?.path?.trim?.() || '.';
  return args?.path ?? '';
}

/**
 * Описание начала выполнения инструмента (для live-отображения)
 *
 * @param {string} name - Имя инструмента
 * @param {object} [args] - Аргументы вызова инструмента
 * @returns {{ title: string, target: string }}
 */
export function describeToolStart(name, args) {
  const title = START_TITLES[name] || name || '';
  const target = toolTarget(name, args);
  return { title, target };
}
