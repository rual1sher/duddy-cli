/** @fileoverview Потоковый фильтр тегов рассуждений модели */

export const THINK_TAG_PAIRS = [
  { open: '<think>', close: '</think>' },
  { open: '<thought>', close: '</thought>' }
];
const ALL_OUTSIDE_TAGS = THINK_TAG_PAIRS.flatMap(p => [p.open, p.close]);
const MAX_OUTSIDE_TAG_LEN = Math.max(...ALL_OUTSIDE_TAGS.map(t => t.length));

/**
 * Создает потоковый фильтр тегов рассуждений (<think>...</think> и <thought>...</thought>),
 * поддерживающий разрыв тегов между чанками и отбрасывающий осиротевшие закрывающие теги.
 *
 * @param {(text: string) => void} onText - Колбэк для текста вне блока рассуждений
 * @param {(think: string) => void} onThink - Колбэк для текста внутри блока рассуждений
 * @returns {{ push: (chunk: string) => void, end: () => void }}
 */
export function createThinkFilter(onText, onThink) {
  let inThink = false;
  let activeCloseTag = null;
  let pending = '';

  function processBuffer() {
    while (pending.length > 0) {
      if (!inThink) {
        let earliest = null;
        for (const pair of THINK_TAG_PAIRS) {
          const openIdx = pending.indexOf(pair.open);
          if (openIdx !== -1 && (earliest === null || openIdx < earliest.index)) {
            earliest = { index: openIdx, tag: pair.open, type: 'open', pair };
          }
          const closeIdx = pending.indexOf(pair.close);
          if (closeIdx !== -1 && (earliest === null || closeIdx < earliest.index)) {
            earliest = { index: closeIdx, tag: pair.close, type: 'close', pair };
          }
        }

        if (earliest !== null) {
          const before = pending.slice(0, earliest.index);
          if (before) onText(before);
          pending = pending.slice(earliest.index + earliest.tag.length);

          if (earliest.type === 'open') {
            inThink = true;
            activeCloseTag = earliest.pair.close;
          }
          // Если earliest.type === 'close' (осиротевший закрывающий тег вне блока рассуждений),
          // просто отбрасываем его без вывода пользователю
          continue;
        }

        // Проверяем, является ли суффикс pending началом какого-то из открывающих или закрывающих тегов
        let matchLen = 0;
        const maxCheck = Math.min(pending.length, MAX_OUTSIDE_TAG_LEN - 1);
        for (let len = maxCheck; len >= 1; len--) {
          const suffix = pending.slice(-len);
          if (ALL_OUTSIDE_TAGS.some(t => t.startsWith(suffix))) {
            matchLen = len;
            break;
          }
        }

        if (matchLen > 0) {
          const emit = pending.slice(0, pending.length - matchLen);
          if (emit) onText(emit);
          pending = pending.slice(-matchLen);
          break;
        } else {
          onText(pending);
          pending = '';
          break;
        }
      } else {
        const idx = pending.indexOf(activeCloseTag);
        if (idx !== -1) {
          const before = pending.slice(0, idx);
          if (before) onThink(before);
          pending = pending.slice(idx + activeCloseTag.length);
          inThink = false;
          activeCloseTag = null;
          continue;
        }

        // Проверяем, является ли суффикс pending префиксом активного закрывающего тега
        let matchLen = 0;
        const maxCheck = Math.min(pending.length, activeCloseTag.length - 1);
        for (let len = maxCheck; len >= 1; len--) {
          if (activeCloseTag.startsWith(pending.slice(-len))) {
            matchLen = len;
            break;
          }
        }

        if (matchLen > 0) {
          const emit = pending.slice(0, pending.length - matchLen);
          if (emit) onThink(emit);
          pending = pending.slice(-matchLen);
          break;
        } else {
          onThink(pending);
          pending = '';
          break;
        }
      }
    }
  }

  return {
    push(chunk) {
      if (!chunk) return;
      pending += chunk;
      processBuffer();
    },
    end() {
      if (pending.length > 0) {
        if (!inThink) {
          onText(pending);
        } else {
          onThink(pending);
        }
        pending = '';
      }
      inThink = false;
      activeCloseTag = null;
    }
  };
}
