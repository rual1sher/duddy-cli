/**
 * @fileoverview Тесты чистого модуля wrapInput (перенос строк, позиция курсора, видимое окно)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapInput,
  cursorPosition,
  visibleRange,
  isWideCodePoint,
  stringDisplayWidth
} from '../src/ui/wrapInput.js';

test('wrapInput: ranges cover the value and rejoin to it', () => {
  const testCases = [
    { value: '', width: 10 },
    { value: 'hello', width: 10 },
    { value: 'hello world and everyone in it', width: 12 },
    { value: 'слово1 слово2 слово3 слово4 слово5', width: 15 },
    { value: 'a\nb\nc\nd', width: 20 },
    { value: 'trailing newline\n', width: 20 },
    { value: 'multiple\n\nnewlines\n\n', width: 10 },
    { value: '   leading and trailing spaces   ', width: 8 },
    { value: '🎉🚀🌟 emoji and text 🌟🚀🎉', width: 12 }
  ];

  for (const { value, width } of testCases) {
    const lines = wrapInput(value, width);
    assert.ok(lines.length >= 1, `Для "${value}" должен быть хотя бы один диапазон`);

    // Проверка непрерывности диапазонов
    assert.strictEqual(lines[0].start, 0, `Первая строка должна начинаться с 0 для "${value}"`);
    for (let i = 1; i < lines.length; i++) {
      assert.strictEqual(
        lines[i].start,
        lines[i - 1].end,
        `Строка ${i} должна начинаться с конца предыдущей (${lines[i - 1].end}) для "${value}"`
      );
    }
    assert.strictEqual(
      lines[lines.length - 1].end,
      value.length,
      `Конец последней строки должен совпадать с длиной строки для "${value}"`
    );

    // Склейка срезов должна возвращать исходное значение
    const rejoined = lines.map(l => value.slice(l.start, l.end)).join('');
    assert.strictEqual(rejoined, value, `Склеенные диапазоны должны давать исходное значение для "${value}"`);
  }
});

test('wrapInput: every line width <= width', () => {
  const texts = [
    'короткий текст',
    'длинный текст с множеством слов разной длины для проверки ограничения ширины',
    'English text mixed with Русский текст and numbers 1234567890',
    'слово_без_пробелов_очень_длинное_которое_превышает_ширину_строки',
    'строка с переносами\nвторая строка\nтретья длинная строка с пробелами'
  ];
  const widths = [10, 15, 20, 35, 50];

  for (const text of texts) {
    for (const width of widths) {
      const lines = wrapInput(text, width);
      for (let i = 0; i < lines.length; i++) {
        const lineSlice = text.slice(lines[i].start, lines[i].end).replace(/\r?\n$/, '');
        const displayW = stringDisplayWidth(lineSlice);
        assert.ok(
          displayW <= width,
          `Строка ${i} ("${lineSlice}") имеет ширину ${displayW} > ${width} (текст: "${text.slice(0, 20)}...")`
        );
      }
    }
  }
});

test('wrapInput: wrapped lines never start with a space when the break was on a single space', () => {
  const text = 'первое_слово второе_слово третье_слово четвёртое_слово';
  const width = 16;
  const lines = wrapInput(text, width);

  assert.ok(lines.length > 1, 'Текст должен быть разбит на несколько строк');
  for (let i = 1; i < lines.length; i++) {
    const lineSlice = text.slice(lines[i].start, lines[i].end);
    assert.ok(
      !lineSlice.startsWith(' '),
      `Перенесённая строка ${i} не должна начинаться с пробела: "${lineSlice}"`
    );
    const prevSlice = text.slice(lines[i - 1].start, lines[i - 1].end);
    assert.ok(
      prevSlice.endsWith(' '),
      `Предыдущая строка ${i - 1} должна заканчиваться пробелом: "${prevSlice}"`
    );
  }
});

test('wrapInput: long word hard break', () => {
  const longWord = 'supercalifragilisticexpialidocious';
  const width = 10;
  const lines = wrapInput(longWord, width);

  assert.strictEqual(lines.length, 4);
  assert.strictEqual(longWord.slice(lines[0].start, lines[0].end), 'supercali');
  assert.strictEqual(longWord.slice(lines[1].start, lines[1].end), 'fragilist');
  assert.strictEqual(longWord.slice(lines[2].start, lines[2].end), 'icexpiali');
  assert.strictEqual(longWord.slice(lines[3].start, lines[3].end), 'docious');

  const rejoined = lines.map(l => longWord.slice(l.start, l.end)).join('');
  assert.strictEqual(rejoined, longWord);
});

test('wrapInput: Cyrillic', () => {
  const cyrillic = 'Привет, мир! Это тестовая строка на кириллице для проверки переноса слов.';
  const width = 20;
  const lines = wrapInput(cyrillic, width);

  assert.ok(lines.length >= 4);
  for (const line of lines) {
    const slice = cyrillic.slice(line.start, line.end).replace(/\r?\n$/, '');
    assert.ok(stringDisplayWidth(slice) <= width);
    // Для каждого кириллического символа экранная ширина равна 1
    for (const ch of slice) {
      assert.strictEqual(isWideCodePoint(ch.codePointAt(0)), false);
    }
  }

  const rejoined = lines.map(l => cyrillic.slice(l.start, l.end)).join('');
  assert.strictEqual(rejoined, cyrillic);
});

test('wrapInput: wide chars (CJK/emoji) count as 2 and surrogate pairs are not split', () => {
  // CJK символы (U+4E00..U+9FFF входят в U+2E80..U+A4CF)
  assert.strictEqual(isWideCodePoint('你'.codePointAt(0)), true);
  assert.strictEqual(isWideCodePoint('好'.codePointAt(0)), true);
  assert.strictEqual(stringDisplayWidth('你好'), 4);

  // Эмодзи из диапазона U+1F300–U+1FAFF
  const rocket = '🚀'; // U+1F680
  const party = '🎉';  // U+1F389
  assert.strictEqual(isWideCodePoint(rocket.codePointAt(0)), true);
  assert.strictEqual(isWideCodePoint(party.codePointAt(0)), true);
  assert.strictEqual(stringDisplayWidth(rocket), 2);
  assert.strictEqual(stringDisplayWidth(party), 2);
  assert.strictEqual(stringDisplayWidth(`a${rocket}b`), 4);

  // Перенос CJK строки
  const cjkText = '你好世界中国'; // 6 символов * 2 = 12 колонок
  const linesCjk = wrapInput(cjkText, 5);
  // В ширину 5 помещается только 2 символа (ширина 4), 3-й символ (ширина 6) не влезает
  assert.strictEqual(cjkText.slice(linesCjk[0].start, linesCjk[0].end), '你好');
  assert.strictEqual(cjkText.slice(linesCjk[1].start, linesCjk[1].end), '世界');
  assert.strictEqual(cjkText.slice(linesCjk[2].start, linesCjk[2].end), '中国');

  // Суррогатные пары эмодзи не должны разбиваться пополам
  const emojiText = '😀😁😂🤣😃';
  const linesEmoji = wrapInput(emojiText, 5);
  for (const line of linesEmoji) {
    const slice = emojiText.slice(line.start, line.end);
    // Проверяем, что первый символ не является висячим low surrogate
    const firstCode = slice.charCodeAt(0);
    assert.ok(firstCode < 0xdc00 || firstCode > 0xdfff, 'Срез не должен начинаться с low surrogate');
    // Проверяем, что последний символ не является висячим high surrogate
    const lastCode = slice.charCodeAt(slice.length - 1);
    assert.ok(lastCode < 0xd800 || lastCode > 0xdbff, 'Срез не должен заканчиваться на high surrogate');
  }

  const rejoined = linesEmoji.map(l => emojiText.slice(l.start, l.end)).join('');
  assert.strictEqual(rejoined, emojiText);
});

test('wrapInput: \\n break', () => {
  const multiline = 'первая строка\nвторая строка\nтретья строка';
  const lines = wrapInput(multiline, 40);

  assert.strictEqual(lines.length, 3);
  assert.strictEqual(multiline.slice(lines[0].start, lines[0].end), 'первая строка\n');
  assert.strictEqual(multiline.slice(lines[1].start, lines[1].end), 'вторая строка\n');
  assert.strictEqual(multiline.slice(lines[2].start, lines[2].end), 'третья строка');

  // Завершающий перевод строки создаёт пустую строку в конце
  const trailingNewline = 'текст с переносом в конце\n';
  const trailingLines = wrapInput(trailingNewline, 40);
  assert.strictEqual(trailingLines.length, 2);
  assert.strictEqual(trailingNewline.slice(trailingLines[0].start, trailingLines[0].end), 'текст с переносом в конце\n');
  assert.strictEqual(trailingNewline.slice(trailingLines[1].start, trailingLines[1].end), '');
  assert.strictEqual(trailingLines.map(l => trailingNewline.slice(l.start, l.end)).join(''), trailingNewline);
});

test('cursorPosition: incl. the full-last-line virtual line', () => {
  const text = 'hello world';
  const width = 8;
  const lines = wrapInput(text, width);
  // Line 0: "hello " (start: 0, end: 6)
  // Line 1: "world" (start: 6, end: 11)

  // .value больше не прикрепляется к массиву lines
  assert.strictEqual(lines.value, undefined);

  // В начале первой строки
  assert.deepStrictEqual(cursorPosition(lines, 0, width, text), { line: 0, col: 0 });
  // Внутри первой строки
  assert.deepStrictEqual(cursorPosition(lines, 3, width, text), { line: 0, col: 3 });
  // На пробеле в конце первой строки
  assert.deepStrictEqual(cursorPosition(lines, 5, width, text), { line: 0, col: 5 });
  // На первом символе второй строки ('w' при offset 6)
  assert.deepStrictEqual(cursorPosition(lines, 6, width, text), { line: 1, col: 0 });
  // В конце второй строки
  assert.deepStrictEqual(cursorPosition(lines, 11, width, text), { line: 1, col: 5 });

  // Виртуальная строка: курсор в самом конце и последняя строка заполнена до width (пробелом на последней колонке)
  const fullText = '1234 ';
  const fullLines = wrapInput(fullText, 5);
  assert.strictEqual(fullLines.length, 1);
  assert.strictEqual(stringDisplayWidth(fullText), 5);

  // Курсор в конце полной строки переходит на виртуальную пустую строку
  const virtualPos = cursorPosition(fullLines, 5, 5, fullText);
  assert.deepStrictEqual(virtualPos, { line: 1, col: 0 });

  // Если курсор не в самом конце, виртуальная строка не создаётся
  const nonEndPos = cursorPosition(fullLines, 4, 5, fullText);
  assert.deepStrictEqual(nonEndPos, { line: 0, col: 4 });

  // Если последняя строка не заполнена до width, виртуальная строка не создаётся
  const notFullText = '1234';
  const notFullLines = wrapInput(notFullText, 5);
  assert.deepStrictEqual(cursorPosition(notFullLines, 4, 5, notFullText), { line: 0, col: 4 });

  // CJK широкие символы: курсор после широкого символа смещается на 2 колонки
  const cjkText = '你好';
  const cjkLines = wrapInput(cjkText, 10);
  assert.deepStrictEqual(cursorPosition(cjkLines, 1, 10, cjkText), { line: 0, col: 2 });
  assert.deepStrictEqual(cursorPosition(cjkLines, 2, 10, cjkText), { line: 0, col: 4 });
});

test('visibleRange: keeps prevStart and scrolls minimally both directions', () => {
  const totalLines = 10;
  const maxLines = 4;

  // Если курсор внутри диапазона [prevStart, prevStart + maxLines), prevStart сохраняется
  assert.strictEqual(visibleRange(totalLines, 0, maxLines, 0), 0);
  assert.strictEqual(visibleRange(totalLines, 2, maxLines, 0), 0);
  assert.strictEqual(visibleRange(totalLines, 3, maxLines, 0), 0);
  assert.strictEqual(visibleRange(totalLines, 4, maxLines, 2), 2);
  assert.strictEqual(visibleRange(totalLines, 5, maxLines, 2), 2);

  // Прокрутка вниз: курсор опустился ниже видимого окна (cursorLine >= prevStart + maxLines)
  // Минимальная прокрутка: start = cursorLine - maxLines + 1
  assert.strictEqual(visibleRange(totalLines, 4, maxLines, 0), 1);
  assert.strictEqual(visibleRange(totalLines, 5, maxLines, 0), 2);
  assert.strictEqual(visibleRange(totalLines, 7, maxLines, 1), 4);
  assert.strictEqual(visibleRange(totalLines, 9, maxLines, 1), 6);

  // Прокрутка вверх: курсор поднялся выше видимого окна (cursorLine < prevStart)
  // Минимальная прокрутка: start = cursorLine
  assert.strictEqual(visibleRange(totalLines, 2, maxLines, 5), 2);
  assert.strictEqual(visibleRange(totalLines, 0, maxLines, 5), 0);
  assert.strictEqual(visibleRange(totalLines, 3, maxLines, 4), 3);

  // Ограничение диапазона (clamping)
  assert.strictEqual(visibleRange(totalLines, -5, maxLines, 3), 0);
  assert.strictEqual(visibleRange(totalLines, 15, maxLines, 0), 6); // maxStart = 10 - 4 = 6
  assert.strictEqual(visibleRange(3, 2, 5, 0), 0); // totalLines <= maxLines
});

test('wrapInput: "aaaa bbbb cc" with width 4 and width 5 preserves invariants', () => {
  const value = 'aaaa bbbb cc';
  for (const width of [4, 5]) {
    const lines = wrapInput(value, width);
    assert.ok(lines.length > 0, `Должна быть хотя бы одна строка для width=${width}`);

    // Rejoined equals value
    const rejoined = lines.map(r => value.slice(r.start, r.end)).join('');
    assert.strictEqual(rejoined, value, `Rejoined must equal value for width=${width}`);

    for (let i = 0; i < lines.length; i++) {
      const slice = value.slice(lines[i].start, lines[i].end);
      const displayW = stringDisplayWidth(slice.replace(/\r?\n$/, ''));

      // Every line width <= width
      assert.ok(
        displayW <= width,
        `Строка ${i} ("${slice}") имеет ширину ${displayW} > ${width} для width=${width}`
      );

      // No space-only line
      assert.ok(
        slice.trim().length > 0,
        `Строка ${i} ("${slice}") состоит только из пробелов для width=${width}`
      );

      // No wrapped line starts with a space
      if (i > 0) {
        assert.ok(
          !slice.startsWith(' '),
          `Перенесённая строка ${i} ("${slice}") начинается с пробела для width=${width}`
        );
      }
    }
  }
});

test('wrapInput: long Cyrillic sentence at widths 5..30 preserves invariants', () => {
  const sentence = 'быстрая бурая лисица перепрыгнула через ленивую собаку посреди осеннего ' +
    'леса когда солнце клонилось к закату и длинные тени ложились на траву';

  for (let width = 5; width <= 30; width++) {
    const lines = wrapInput(sentence, width);
    assert.ok(lines.length > 0, `Должна быть хотя бы одна строка для width=${width}`);

    // Rejoined equals value
    const rejoined = lines.map(r => sentence.slice(r.start, r.end)).join('');
    assert.strictEqual(rejoined, sentence, `Rejoined must equal sentence for width=${width}`);

    for (let i = 0; i < lines.length; i++) {
      const slice = sentence.slice(lines[i].start, lines[i].end);
      const displayW = stringDisplayWidth(slice.replace(/\r?\n$/, ''));

      // Every line width <= width
      assert.ok(
        displayW <= width,
        `Строка ${i} ("${slice}") имеет ширину ${displayW} > ${width} для width=${width}`
      );

      // No space-only line
      assert.ok(
        slice.trim().length > 0,
        `Строка ${i} ("${slice}") состоит только из пробелов для width=${width}`
      );

      // No wrapped line starts with a space
      if (i > 0) {
        assert.ok(
          !slice.startsWith(' '),
          `Перенесённая строка ${i} ("${slice}") начинается с пробела для width=${width}`
        );
      }
    }
  }
});
