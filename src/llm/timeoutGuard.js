/**
 * @fileoverview Сторож таймаутов потокового ответа модели
 */

// Модель может молчать, пока думает или собирает большой вызов инструмента,
// поэтому лимит большой, а прервать можно вручную
export const FIRST_CHUNK_TIMEOUT_MS = 600000;
// Модель может отдавать вызов инструмента одним чанком, поэтому после текста
// тишина бывает такой же долгой, как перед первым чанком
export const STREAM_STALL_TIMEOUT_MS = FIRST_CHUNK_TIMEOUT_MS;

/**
 * Создает сторож таймаутов стрима, таймер перезапускается на каждом чанке
 *
 * @param {object} params - Параметры сторожа таймаутов
 * @param {AbortSignal} [params.signal] - Внешний сигнал отмены
 * @param {number} params.firstChunkTimeoutMs - Таймаут первого чанка в мс
 * @param {number} params.stallTimeoutMs - Таймаут тишины между чанками в мс
 * @returns {object} Объект управления таймаутами
 */
export function createTimeoutGuard({ signal, firstChunkTimeoutMs, stallTimeoutMs }) {
  const internalController = new AbortController();
  let timedOut = false;
  let receivedChunk = false;

  const onExternalAbort = () => {
    internalController.abort();
  };

  if (signal) {
    if (signal.aborted) {
      internalController.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  let timer = null;
  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const armTimer = (ms) => {
    clearTimer();
    timer = setTimeout(() => {
      timedOut = true;
      internalController.abort();
    }, ms);
  };

  armTimer(firstChunkTimeoutMs);

  return {
    signal: internalController.signal,
    get timedOut() {
      return timedOut;
    },
    get receivedChunk() {
      return receivedChunk;
    },
    onChunk() {
      receivedChunk = true;
      armTimer(stallTimeoutMs);
    },
    dispose() {
      clearTimer();
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }
    },
    toError(model) {
      if (!timedOut) return null;
      if (receivedChunk) {
        const timeoutErr = new Error(
          `Ответ модели ${model} оборвался: нет новых чанков ${Math.round(stallTimeoutMs / 1000)} с`
        );
        timeoutErr.code = 'STREAM_STALL_TIMEOUT';
        return timeoutErr;
      }
      const timeoutErr = new Error(
        `Модель ${model} не прислала ни одного чанка за ${Math.round(firstChunkTimeoutMs / 1000)} с — ` +
        'возможно, она ещё думала над ответом или запрос завис'
      );
      timeoutErr.code = 'FIRST_CHUNK_TIMEOUT';
      return timeoutErr;
    }
  };
}
