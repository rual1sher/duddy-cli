import { streamChatCompletion } from './api.js';
import { AGENT_TOOLS, executeTool } from './tools.js';

export const MAX_HISTORY_TURNS = 10;
export const MAX_TOOL_TURNS = 10;

/**
 * Исполняет один агентный ход (Agent Turn): отправляет сообщения модели,
 * сообщает о происходящем через колбэки events, выполняет вызовы инструментов (до MAX_TOOL_TURNS)
 * и накапливает порожденные сообщения и статистику токенов.
 *
 * @param {object} params
 * @param {object} params.session - Текущая сессия Duddy (модель, токен, статистика)
 * @param {Array<object>} params.messages - Массив сообщений для OpenRouter API
 * @param {object} [params.toolCtx] - Контекст прав для executeTool (autoApprove, canPrompt, log, approve)
 * @param {AbortSignal} [params.signal] - Сигнал отмены (например, по SIGINT)
 * @param {object} [params.events={}] - Колбэки событий рендерера
 * @returns {Promise<{ finalText: string, newMessages: Array<object>, lastUsage: object|null, hitTurnLimit: boolean, elapsedMs: number, routedModel: string }>}
 */
export async function runAgentTurn({ session, messages, toolCtx, signal, events = {} }) {
  const newMessages = [];
  let finalText = '';
  let lastUsage = null;
  let hitTurnLimit = false;
  let routedModel = '';
  const activeToolCtx = toolCtx || session?.toolCtx || { autoApprove: !!session?.autoApprove, canPrompt: true };

  const startedAt = Date.now();
  let turn = 0;

  const emit = (name, ...args) => {
    if (typeof events[name] === 'function') {
      events[name](...args);
    }
  };

  while (true) {
    emit('onPhase', 'thinking');

    const { content, toolCalls, usage } = await streamChatCompletion({
      provider: session.provider,
      apiKey: session.apiKey,
      model: session.model,
      messages,
      tools: AGENT_TOOLS,
      temperature: session.temperature ?? 0.4,
      reasoningEffort: session.reasoningEffort,
      // Google sends nothing while the model thinks, so high effort needs a longer wait
      firstChunkTimeoutMs: session.reasoningEffort === 'high' ? 180000 : 90000,
      signal,
      onModel: (m) => {
        routedModel = m;
        session.lastRoutedModel = m;
        emit('onModel', m);
      },
      onReasoning: () => {
        emit('onPhase', 'reasoning');
      },
      onChunk: (chunk) => {
        emit('onText', chunk);
      },
      onWarning: (warningText) => {
        emit('onWarning', warningText);
      }
    });

    if (usage) {
      lastUsage = usage;
      session.lastUsage = usage;
      const total = usage.total_tokens || 0;
      session.totalTokens = (session.totalTokens || 0) + total;
      if (!session.modelUsage) {
        session.modelUsage = {};
      }
      if (!session.modelUsage[session.model]) {
        session.modelUsage[session.model] = { lastTokens: 0, totalTokens: 0 };
      }
      session.modelUsage[session.model].lastTokens = total;
      session.modelUsage[session.model].totalTokens += total;
    }

    if (typeof events.onStepEnd === 'function') {
      await events.onStepEnd();
    }

    if (toolCalls && toolCalls.length > 0) {
      if (turn >= MAX_TOOL_TURNS) {
        hitTurnLimit = true;
        emit('onWarning', 'Достигнут лимит в 10 шагов инструментов — ход остановлен.');
        finalText = '';
        break;
      }

      turn++;

      // Если у tool call пустой id, генерируем call_${turn}_${index}
      for (let i = 0; i < toolCalls.length; i++) {
        if (!toolCalls[i].id) {
          toolCalls[i].id = `call_${turn}_${i}`;
        }
      }

      const assistantMsg = {
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls
      };
      messages.push(assistantMsg);
      newMessages.push(assistantMsg);

      emit('onPhase', 'tools');

      for (let i = 0; i < toolCalls.length; i++) {
        const call = toolCalls[i];
        const funcName = call.function?.name || '';
        let funcArgs = null;
        let parseError = null;

        try {
          funcArgs = JSON.parse(call.function?.arguments || '{}');
        } catch (err) {
          parseError = err;
          funcArgs = null;
        }

        emit('onToolStart', { id: call.id, name: funcName, args: funcArgs });

        let toolResultContent = '';
        if (parseError) {
          toolResultContent = `Ошибка: аргументы вызова ${funcName} — невалидный JSON (${parseError.message}). Повтори вызов с корректным JSON.`;
          if (typeof activeToolCtx.log === 'function') {
            activeToolCtx.log('error', `✖ ${toolResultContent}`);
          }
        } else {
          const toolResult = await executeTool(funcName, funcArgs, activeToolCtx);
          toolResultContent = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
        }

        const ok = !toolResultContent.startsWith('Ошибка') && !toolResultContent.startsWith('Отклонено');
        const summary = (toolResultContent.split('\n')[0] || '').slice(0, 120);

        emit('onToolResult', { id: call.id, name: funcName, ok, summary });

        const toolMsg = {
          role: 'tool',
          tool_call_id: call.id,
          name: funcName,
          content: toolResultContent
        };
        messages.push(toolMsg);
        newMessages.push(toolMsg);
      }

      continue;
    }

    // Финальный ответ модели получен
    finalText = content || '';
    if (finalText) {
      const finalMsg = { role: 'assistant', content: finalText };
      messages.push(finalMsg);
      newMessages.push(finalMsg);
    }
    break;
  }

  if (routedModel) {
    session.lastRoutedModel = routedModel;
  }

  const elapsedMs = Date.now() - startedAt;

  return {
    finalText,
    newMessages,
    lastUsage,
    hitTurnLimit,
    elapsedMs,
    routedModel
  };
}
