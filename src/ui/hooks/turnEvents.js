/**
 * @fileoverview Обработчики событий хода агента и формирование завершающей записи
 */

import { formatDuration } from '../../render/formatter.js';
import { describeToolStart, requestsSuffix } from '../../render/toolDisplay.js';
import { recordRequest } from '../../models/limits.js';

/**
 * Формирует запись о завершении агентного хода с длительностью, счётчиком запросов и изменениями
 *
 * @param {number} turnElapsed - Длительность хода в мс
 * @param {Map<string, string>} changesMap - Карта изменений файлов
 * @param {number} [requestCount] - Число HTTP-запросов к модели за ход
 * @returns {object}
 */
export function buildDoneItem(turnElapsed, changesMap, requestCount) {
  const created = [];
  const modified = [];
  const deleted = [];
  for (const [p, ch] of changesMap.entries()) {
    if (ch === 'created') created.push(p);
    else if (ch === 'modified') modified.push(p);
    else if (ch === 'deleted') deleted.push(p);
  }
  const changes = { created, modified, deleted };

  return {
    type: 'done',
    text: `✔ ${formatDuration(turnElapsed)}${requestsSuffix(requestCount)}`,
    changes
  };
}

/**
 * Создает объект обработчиков событий для runAgentTurn
 *
 * @param {object} params
 * @returns {object} Обработчики событий хода
 */
export function createTurnEvents({
  queueRef,
  setQueued,
  commitLiveText,
  setTranscript,
  setPhase,
  session,
  modelLabelRef,
  queueLiveText,
  liveToolsRef,
  setLiveTools,
  changesRef
}) {
  return {
    takeQueued: () => {
      const taken = queueRef.current;
      queueRef.current = [];
      setQueued([]);
      return taken;
    },
    onQueuedInjected: (texts) => {
      commitLiveText();
      setTranscript(prev => [
        ...prev,
        ...texts.map(text => ({ type: 'user', text }))
      ]);
    },
    onPhase: (p) => {
      setPhase(p);
    },
    onModel: (id) => {
      if (id && id !== session.model) {
        modelLabelRef.current = `${session.model} → ${id}`;
      }
    },
    onText: (delta) => {
      queueLiveText(delta);
    },
    onStepEnd: async () => {
      commitLiveText();
    },
    onToolStart: ({ id, name, args }) => {
      const display = describeToolStart(name, args);
      const target = display?.target ?? args?.path ?? '';
      const next = [...liveToolsRef.current, { id, name, target, display, logs: [] }];
      liveToolsRef.current = next;
      setLiveTools(next);
    },
    onToolResult: ({ id, name, ok, summary, display }) => {
      const prev = liveToolsRef.current;
      const item = prev.find(t => t.id === id) || { id, name, target: '', logs: [] };
      const target = display?.target ?? item.target ?? '';
      const title = display?.title;
      const toolSummary = display ? display.summary : summary;
      const diff = display?.diff || [];
      const change = display?.change || null;

      if (change && target) {
        const prevChange = changesRef.current.get(target);
        if (prevChange === 'created' && change === 'modified') {
          // оставить 'created'
        } else {
          changesRef.current.set(target, change);
        }
      }

      const toolResultItem = {
        type: 'tool',
        name: item.name || name,
        title,
        target,
        ok,
        summary: toolSummary,
        diff,
        change,
        logs: item.logs || []
      };
      const next = prev.filter(t => t.id !== id);
      liveToolsRef.current = next;
      setLiveTools(next);
      setTranscript(tPrev => [...tPrev, toolResultItem]);
    },
    onWarning: (msg) => {
      setTranscript(prev => [...prev, { type: 'note', level: 'warn', text: msg }]);
    },
    onRequestDone: ({ usage, rateLimits }) => {
      recordRequest(session.provider, session.model, usage, rateLimits);
    }
  };
}
