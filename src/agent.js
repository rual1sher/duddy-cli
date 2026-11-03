import { streamChatCompletion } from './llm/stream.js';
import { AGENT_TOOLS } from './tools/definitions.js';
import { executeTool } from './tools/execute.js';
import { describeToolResult } from './toolDisplay.js';
import { compactToolResults } from './llm/compact.js';
import { toolsForMode } from './modes.js';

export const MAX_HISTORY_TURNS = 10;
export const MAX_TOOL_TURNS = 10;
const SECRET_REMOVED = '[Содержимое файла с секретами удалено из истории. Если оно снова нужно, прочитай файл заново: пользователь подтвердит доступ.]';

/**
 * Исполняет один агентный ход (Agent Turn): отправляет сообщения модели,
 * сообщает о происходящем через колбэки events, выполняет вызовы инструментов (до MAX_TOOL_TURNS)
 * и накапливает порожденные сообщения и статистику токенов.
 * При ошибке запроса к модели у ошибки есть partialMessages — завершённые шаги хода.
 *
 * @param {object} params
 * @param {object} params.session - Текущая сессия Duddy (модель, токен, статистика)
 * @param {Array<object>} params.messages - Массив сообщений для OpenRouter API
 * @param {object} [params.toolCtx] - Контекст прав для executeTool (autoApprove, canPrompt, log, approve)
 * @param {AbortSignal} [params.signal] - Сигнал отмены (например, по SIGINT)
 * @param {object} [params.events={}] - Колбэки событий рендерера
 * @param {() => string[]} [params.events.takeQueued] - Функция извлечения сообщений из очереди пользователя
 * @param {(texts: string[]) => void} [params.events.onQueuedInjected] - Колбэк при внедрении сообщений из очереди в текущий ход
 * @param {(info: { id: string, name: string, args: object|null }) => void} [params.events.onToolStart] - Колбэк начала выполнения инструмента
 * @param {(info: { id: string, name: string, ok: boolean, summary: string, display: object }) => void} [params.events.onToolResult] - Колбэк завершения вызова инструмента
 * @param {(info: { usage: object|null, rateLimits: object|null }) => void} [params.events.onRequestDone] - Колбэк завершения HTTP-запроса к модели с данными о токенах и лимитах
 * @returns {Promise<{ finalText: string, newMessages: Array<object>, lastUsage: object|null, turnUsage: { input: number, output: number, cached: number }, hitTurnLimit: boolean, elapsedMs: number, routedModel: string }>}
 * @throws {Error & { partialMessages?: Array<object> }} При ошибке запроса к модели у ошибки есть partialMessages — завершённые шаги хода
 */
export async function runAgentTurn({ session, messages, toolCtx, signal, events = {} }) {
  const newMessages = [];
  let finalText = '';
  let lastUsage = null;
  let hitTurnLimit = false;
  let routedModel = '';
  const activeToolCtx = toolCtx || session?.toolCtx || { autoApprove: !!session?.autoApprove, canPrompt: true };

  activeToolCtx.signal = signal;
  // История между ходами обрезается, поэтому «модель видела файл» действует только в пределах хода
  activeToolCtx.fullyRead = new Map();
  activeToolCtx.seenReads = new Map();
  const readCalls = new Map();
  const turnUsage = { input: 0, output: 0, cached: 0 };

  const startedAt = Date.now();
  let turn = 0;

  const emit = (name, ...args) => {
    if (typeof events[name] === 'function') {
      events[name](...args);
    }
  };

  while (true) {
    emit('onPhase', 'thinking');

    // Убранный результат модель больше не видит, поэтому файл снова считается непрочитанным
    for (const id of compactToolResults(messages)) {
      const read = readCalls.get(id);
      if (read) {
        activeToolCtx.fullyRead.delete(read.fullPath);
        activeToolCtx.seenReads.delete(read.readKey);
      }
    }

    // Перед вызовом newMessages всегда содержит только завершённые шаги, поэтому пары assistant.tool_calls ↔ tool не разрываются
    let stepText = '';
    let streamResult;
    try {
      streamResult = await streamChatCompletion({
        provider: session.provider,
        apiKey: session.apiKey,
        model: session.model,
        sessionId: session.id,
        messages,
        tools: toolsForMode(AGENT_TOOLS, activeToolCtx.mode),
        temperature: session.temperature ?? 0.4,
        reasoningEffort: session.reasoningEffort,
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
          stepText += chunk;
          emit('onText', chunk);
        },
        onWarning: (warningText) => {
          emit('onWarning', warningText);
        }
      });
    } catch (err) {
      if (stepText.trim()) {
        newMessages.push({ role: 'assistant', content: `${stepText}\n\n(ответ оборван)` });
      }
      err.partialMessages = [...newMessages];
      throw err;
    }
    const { content, toolCalls, usage } = streamResult;

    if (usage) {
      lastUsage = usage;
      session.lastUsage = usage;
      turnUsage.input += usage.prompt_tokens || 0;
      turnUsage.output += usage.completion_tokens || 0;
      turnUsage.cached += usage.prompt_tokens_details?.cached_tokens || 0;
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

    emit('onRequestDone', { usage, rateLimits: streamResult.rateLimits });

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

      // Парсинг аргументов до формирования assistantMsg: для вызовов с невалидным JSON
      // заменяем arguments на "{}", чтобы провайдер не отклонил следующий запрос
      const parsedCalls = [];
      for (let i = 0; i < toolCalls.length; i++) {
        const call = toolCalls[i];
        let funcArgs = null;
        let parseError = null;

        try {
          funcArgs = JSON.parse(call.function?.arguments || '{}');
        } catch (err) {
          parseError = err;
          funcArgs = null;
          if (call.function) {
            call.function.arguments = '{}';
          }
        }

        parsedCalls.push({ funcArgs, parseError });
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
        const { funcArgs, parseError } = parsedCalls[i];

        emit('onToolStart', { id: call.id, name: funcName, args: funcArgs });

        const toolMeta = {};
        let toolResultContent = '';
        if (signal?.aborted) {
          toolResultContent = 'Отклонено: пользователь прервал ход';
        } else if (parseError) {
          toolResultContent = `Ошибка: аргументы вызова ${funcName} — невалидный JSON (${parseError.message}). Повтори вызов с корректным JSON. Экранируй кавычки и переводы строк в строковых значениях.`;
        } else {
          const toolResult = await executeTool(funcName, funcArgs, activeToolCtx, toolMeta);
          toolResultContent = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
          if (toolMeta.readKey) {
            readCalls.set(call.id, toolMeta);
          }
        }

        const ok = !toolResultContent.startsWith('Ошибка') && !toolResultContent.startsWith('Отклонено');
        const summary = (toolResultContent.split('\n')[0] || '').slice(0, 120);
        const display = describeToolResult(funcName, funcArgs, toolResultContent, ok);

        emit('onToolResult', { id: call.id, name: funcName, ok, summary, display });

        const toolMsg = {
          role: 'tool',
          tool_call_id: call.id,
          name: funcName,
          content: toolResultContent
        };
        // Модель видит секрет только в текущем ходе, в историю сессии уходит заглушка
        messages.push(toolMsg);
        newMessages.push(toolMeta.secret ? { ...toolMsg, content: SECRET_REMOVED } : toolMsg);
      }

      if (!signal?.aborted && typeof events.takeQueued === 'function') {
        const queuedTexts = events.takeQueued();
        if (Array.isArray(queuedTexts) && queuedTexts.length > 0) {
          for (const text of queuedTexts) {
            const userMsg = { role: 'user', content: text };
            messages.push(userMsg);
            newMessages.push(userMsg);
          }
          emit('onQueuedInjected', queuedTexts);
        }
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
    turnUsage,
    hitTurnLimit,
    elapsedMs,
    routedModel
  };
}
