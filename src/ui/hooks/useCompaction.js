/**
 * @fileoverview Хук сжатия истории диалога (автоматическое перед ходом и по команде /compact)
 */

import { useCallback } from 'react';
import {
  needsCompaction,
  compactHistory,
  dropOldHistory
} from '../../agent/compactHistory.js';
import { errorText } from '../../llm/errors.js';
import { requestsSuffix } from '../../render/toolDisplay.js';

/**
 * Хук управления сжатием истории диалога
 *
 * @param {object} params
 * @param {object} params.session - Текущая сессия Duddy
 * @param {React.MutableRefObject<boolean>} params.busyRef - Флаг занятости агента
 * @param {React.MutableRefObject<AbortController|null>} params.abortControllerRef - Ссылка на контроллер отмены
 * @param {(status: string) => void} params.setStatus - Установка статуса ('idle'|'working')
 * @param {(phase: string) => void} params.setPhase - Установка фазы ('compacting'|'thinking'|и др.)
 * @param {(ms: number|null) => void} params.setStartedAt - Установка времени начала работы
 * @param {(level: string, text: string) => void} params.addNote - Добавление системной заметки
 * @returns {{ maybeCompactBeforeTurn: (signal: AbortSignal) => Promise<void>, compactNow: () => Promise<void> }}
 */
export function useCompaction({
  session,
  busyRef,
  abortControllerRef,
  setStatus,
  setPhase,
  setStartedAt,
  addNote
}) {
  const maybeCompactBeforeTurn = useCallback(async (signal) => {
    if (!needsCompaction(session)) return;

    const lastTokens = session.lastUsage?.total_tokens ?? 0;
    const contextLength = session.contextLength || 1;
    const usedPct = Math.round((lastTokens / contextLength) * 100);

    setPhase('compacting');
    let count = 0;
    try {
      const result = await compactHistory(session, {
        signal,
        onRequest: () => { count++; }
      });
      if (result.compacted) {
        addNote('info', `Контекст заполнен на ${usedPct}% — старая история сжата в пересказ${requestsSuffix(count)}`);
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      dropOldHistory(session);
      addNote(
        'warn',
        `Не удалось сжать историю (${errorText(err)}) — старые сообщения удалены, последние 2 хода сохранены`
      );
    } finally {
      setPhase('thinking');
    }
  }, [session, setPhase, addNote]);

  const compactNow = useCallback(async () => {
    if (busyRef.current) {
      addNote('warn', 'Команды недоступны во время ответа');
      return;
    }

    busyRef.current = true;
    setStatus('working');
    setPhase('compacting');
    setStartedAt(Date.now());
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    let count = 0;

    try {
      const res = await compactHistory(session, {
        signal,
        onRequest: () => { count++; }
      });
      if (!res.compacted) {
        addNote('info', 'Сжимать нечего: в истории не больше 2 ходов');
      } else {
        addNote('info', `История сжата в пересказ${requestsSuffix(count)}`);
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted) {
        addNote('warn', 'Остановлено');
      } else {
        addNote('warn', errorText(err));
      }
    } finally {
      setStatus('idle');
      setPhase('thinking');
      setStartedAt(null);
      abortControllerRef.current = null;
      busyRef.current = false;
    }
  }, [session, busyRef, abortControllerRef, setStatus, setPhase, setStartedAt, addNote]);

  return { maybeCompactBeforeTurn, compactNow };
}
