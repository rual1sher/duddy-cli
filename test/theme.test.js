import { test } from 'node:test';
import assert from 'node:assert/strict';
import chalk from 'chalk';
import {
  THEMES,
  THEME_IDS,
  DEFAULT_THEME,
  setTheme,
  getThemeId,
  theme,
  paint
} from '../src/theme.js';
import { kittenLines } from '../src/banner.js';

test('THEME_IDS содержит 4 идентификатора: ровно 2 тёмные и 2 светлые темы', () => {
  assert.strictEqual(THEME_IDS.length, 4);
  const darks = THEME_IDS.filter(id => THEMES[id].dark === true);
  const lights = THEME_IDS.filter(id => THEMES[id].dark === false);
  assert.strictEqual(darks.length, 2);
  assert.strictEqual(lights.length, 2);
});

test('каждая тема определяет ровно тот же набор ключей цветов, что и THEMES.dark, каждое значение соответствует /^#[0-9a-f]{6}$/i', () => {
  const darkKeys = Object.keys(THEMES.dark.colors).sort();
  const hexPattern = /^#[0-9a-f]{6}$/i;
  for (const id of THEME_IDS) {
    const keys = Object.keys(THEMES[id].colors).sort();
    assert.deepStrictEqual(keys, darkKeys, `Ключи темы ${id} не совпадают с THEMES.dark`);
    for (const [token, color] of Object.entries(THEMES[id].colors)) {
      assert.match(color, hexPattern, `Цвет ${token} темы ${id} не соответствует формату hex: ${color}`);
    }
  }
});

test('setTheme("nope") возвращает "dark" и getThemeId() === "dark"; setTheme("light") -> theme().text === "#0f172a"; восстанавливает setTheme("dark")', () => {
  try {
    const fallback = setTheme('nope');
    assert.strictEqual(fallback, 'dark');
    assert.strictEqual(getThemeId(), 'dark');

    const appliedLight = setTheme('light');
    assert.strictEqual(appliedLight, 'light');
    assert.strictEqual(getThemeId(), 'light');
    assert.strictEqual(theme().text, '#0f172a');
  } finally {
    setTheme('dark');
    assert.strictEqual(getThemeId(), 'dark');
  }
});

test('результат kittenLines() отличается между dark и light при принудительном chalk.level = 3', () => {
  const originalLevel = chalk.level;
  try {
    chalk.level = 3;
    setTheme('dark');
    const darkLines = kittenLines();
    setTheme('light');
    const lightLines = kittenLines();
    assert.notDeepStrictEqual(darkLines, lightLines);
  } finally {
    chalk.level = originalLevel;
    setTheme('dark');
  }
});

test('каждая тема имеет background формата hex и непустую строку hint', () => {
  const hexPattern = /^#[0-9a-f]{6}$/i;
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    assert.match(t.background, hexPattern, `background темы ${id} не соответствует формату hex: ${t.background}`);
    assert.strictEqual(typeof t.hint, 'string', `hint темы ${id} должен быть строкой`);
    assert.ok(t.hint.trim().length > 0, `hint темы ${id} не должен быть пустым`);
  }
});
