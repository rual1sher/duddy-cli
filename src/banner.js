/**
 * @fileoverview Приветственный баннер Duddy CLI с пиксель-арт котёнком
 */

import chalk from 'chalk';
import fs from 'node:fs';
import { getThemeId, paint } from './theme.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * Спрайт котёнка: 6 строк по 14 колонок пикселей ('X' — пиксель, '.' — пусто).
 * Каждые 2 строки и 2 колонки пикселей формируют одну ячейку терминала символом квадранта.
 */
export const KITTEN_ROWS = [
  'XX..........XX',
  'XXX........XXX',
  'XXXXXXXXXXXXXX',
  'XX..XXXXXX..XX',
  'XXXXXX..XXXXXX',
  '.XXXXXXXXXXXX.',
];

/** Таблица символов квадрантов Unicode по 4-битной маске (UL=1, UR=2, LL=4, LR=8) */
const QUADRANTS = [' ','▘','▝','▀','▖','▌','▞','▛','▗','▚','▐','▜','▄','▙','▟','█'];

/** Кэш отрендеренных кадров котёнка */
const kittenCache = new Map();

/**
 * Формирует 3 строки терминала с пиксель-арт котёнком (7 видимых колонок).
 *
 * @param {object} [options]
 * @param {number} [options.rise=0] - Сдвиг спрайта вниз (0..6, где 6 — полностью пустой)
 * @param {boolean} [options.blink=false] - Признак закрытых глаз (моргание)
 * @param {boolean} [options.twitch=false] - Признак подёргивания правого уха
 * @returns {string[]} Массив из 3 строк по 7 колонок
 */
export function kittenLines({ rise = 0, blink = false, twitch = false } = {}) {
  const key = `${getThemeId()}|${rise}|${blink}|${twitch}`;
  if (kittenCache.has(key)) {
    return kittenCache.get(key);
  }

  // Копия сетки
  const rows = [...KITTEN_ROWS];

  if (blink) {
    // В строке 3 глаза исчезают на мгновение
    rows[3] = 'XXXXXXXXXXXXXX';
  }

  if (twitch) {
    // Правый кончик уха подгибается
    rows[0] = 'XX...........X';
  }

  // Сдвиг спрайта вниз на rise строк пикселей внутри рамки из 6 строк
  const shifted = [];
  for (let y = 0; y < 6; y++) {
    const oldY = y - rise;
    if (oldY < 0 || oldY >= 6) {
      shifted.push('..............');
    } else {
      shifted.push(rows[oldY]);
    }
  }

  // Рендерим каждую строку k терминала из строк пикселей 2k (верх) и 2k+1 (низ)
  const lines = [];
  for (let k = 0; k < 3; k++) {
    let line = '';
    for (let c = 0; c < 7; c++) {
      let mask = 0;
      if (shifted[2 * k][2 * c] === 'X') mask |= 1;
      if (shifted[2 * k][2 * c + 1] === 'X') mask |= 2;
      if (shifted[2 * k + 1][2 * c] === 'X') mask |= 4;
      if (shifted[2 * k + 1][2 * c + 1] === 'X') mask |= 8;
      line += QUADRANTS[mask];
    }
    lines.push(paint('accent')(line));
  }

  kittenCache.set(key, lines);
  return lines;
}

/**
 * Формирует строки приветственного баннера для отображения в терминале.
 *
 * @param {object} [options]
 * @param {string} [options.model='openrouter/free'] - Идентификатор активной модели
 * @param {string} [options.provider='openrouter'] - Идентификатор активного провайдера
 * @param {boolean} [options.hasKey=false] - Признак наличия API-ключа
 * @param {string} [options.cwd=process.cwd()] - Текущая рабочая папка
 * @param {object} [frame={}] - Параметры кадра анимации
 * @param {number} [frame.rise=0] - Сдвиг спрайта вниз (0..6)
 * @param {boolean} [frame.blink=false] - Моргание
 * @param {boolean} [frame.twitch=false] - Подёргивание уха
 * @param {number} [frame.reveal=1] - Доля отображаемого информационного текста (0..1)
 * @returns {string[]} Массив строк баннера
 */
export function bannerLines(
  { model = 'openrouter/free', provider = 'openrouter', hasKey = false, cwd = process.cwd() } = {},
  frame = {}
) {
  const { rise = 0, blink = false, twitch = false, reveal = 1 } = frame;

  const home = process.env.HOME || process.env.USERPROFILE || '';
  let prettyPath = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  const terminalCols = process.stdout.columns || 80;
  const maxPathLen = Math.max(1, terminalCols - 13);
  if (prettyPath.length > maxPathLen) {
    prettyPath = '…' + prettyPath.slice(-(maxPathLen - 1));
  }

  // Формирование текста заголовка с эффектом пишущей машинки
  const nameText = 'Duddy';
  const verText = ' v' + pkg.version;
  const fullTitle = nameText + verText;
  const titleChars = Math.ceil(fullTitle.length * reveal);

  let title = '';
  if (titleChars > 0) {
    if (titleChars <= nameText.length) {
      title = paint('accent').bold(nameText.slice(0, titleChars));
    } else if (titleChars === nameText.length + 1) {
      title = paint('accent').bold(nameText) + ' ';
    } else {
      const verSlice = ('v' + pkg.version).slice(0, titleChars - nameText.length - 1);
      title = paint('accent').bold(nameText) + ' ' + chalk.dim(verSlice);
    }
  }

  // Строка модели
  const fullModel = hasKey ? model : 'ключ не задан — выполните /login';
  const modelChars = Math.ceil(fullModel.length * reveal);
  const visibleModel = fullModel.slice(0, modelChars);
  const modelInfo = visibleModel
    ? (hasKey ? paint('muted')(visibleModel) : paint('warning')(visibleModel))
    : '';

  // Строка пути
  const pathChars = Math.ceil(prettyPath.length * reveal);
  const visiblePath = prettyPath.slice(0, pathChars);
  const pathInfo = visiblePath ? paint('subtle')(visiblePath) : '';

  const [a0, a1, a2] = kittenLines({ rise, blink, twitch });

  return [
    '',
    '  ' + a0 + '  ' + title,
    '  ' + a1 + '  ' + modelInfo,
    '  ' + a2 + '  ' + pathInfo,
    ''
  ];
}
