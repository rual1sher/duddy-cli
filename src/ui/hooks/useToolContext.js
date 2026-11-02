/**
 * @fileoverview Контекст исполнения инструментов и подтверждения операций пользователем
 */

import { useRef } from 'react';

/**
 * Создает контекст инструментов и связывает его с сессией при каждом рендере
 *
 * @param {object} params
 * @param {object} params.session - Текущая сессия
 * @param {React.MutableRefObject<Array>} params.liveToolsRef - Реф списка активных инструментов
 * @param {Function} params.setLiveTools - Сеттер списка активных инструментов
 * @param {Function} params.setOverlay - Сеттер активного оверлея
 * @param {React.MutableRefObject<number>} params.lastActivityRef - Реф временной метки последней активности
 * @returns {{ toolCtxRef: React.MutableRefObject<object> }}
 */
export function useToolContext({ session, liveToolsRef, setLiveTools, setOverlay, lastActivityRef }) {
  const toolCtxRef = useRef({
    autoApprove: Boolean(session.autoApprove),
    allowCommands: Boolean(session.autoApprove),
    allowedCommands: new Set(),
    canPrompt: true,
    log: (level, text) => {
      const prev = liveToolsRef.current;
      if (prev.length === 0) return;
      const last = prev[prev.length - 1];
      const updated = {
        ...last,
        logs: [...(last.logs || []), { level, text }]
      };
      const next = [...prev.slice(0, -1), updated];
      liveToolsRef.current = next;
      setLiveTools(next);
    },
    approve: ({ name, relPath, preview, sensitive, scope }) => {
      return new Promise((resolve) => {
        setOverlay({
          kind: 'approval',
          name,
          relPath,
          preview,
          sensitive,
          scope,
          onResolve: (choice) => {
            lastActivityRef.current = Date.now();
            setOverlay(null);
            resolve(choice);
          }
        });
      });
    }
  });

  session.toolCtx = toolCtxRef.current;

  return { toolCtxRef };
}
