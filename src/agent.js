import chalk from 'chalk';
import ora from 'ora';
import { streamChatCompletion } from './api.js';
import { AnimatedTerminalRenderer, formatDuration } from './formatter.js';
import { AGENT_TOOLS, executeTool } from './tools.js';

export const MAX_HISTORY_TURNS = 10;
export const MAX_TOOL_TURNS = 10;

/**
 * Исполняет один агентный ход (Agent Turn): отправляет сообщения модели,
 * отображает рассуждения и потоковый вывод, выполняет вызовы инструментов (до MAX_TOOL_TURNS)
 * и накапливает порожденные сообщения и статистику токенов.
 *
 * @param {object} params
 * @param {object} params.session - Текущая сессия Duddy (модель, токен, статистика)
 * @param {Array<object>} params.messages - Массив сообщений для OpenRouter API
 * @param {object} [params.toolCtx] - Контекст прав для executeTool (autoApprove, canPrompt)
 * @param {AbortSignal} [params.signal] - Сигнал отмены (например, по SIGINT)
 * @returns {Promise<{ finalText: string, newMessages: Array<object>, lastUsage: object|null, hitTurnLimit: boolean, elapsedMs: number, routedModel: string }>}
 */
export async function runAgentTurn({ session, messages, toolCtx, signal }) {
  const newMessages = [];
  let finalText = '';
  let lastUsage = null;
  let hitTurnLimit = false;
  let routedModel = '';
  const activeToolCtx = toolCtx || session.toolCtx || { autoApprove: !!session.autoApprove, canPrompt: true };

  const modelLabel = () =>
    routedModel && routedModel !== session.model
      ? `${session.model} → ${routedModel}`
      : session.model;

  const startedAt = Date.now();
  let phase = 'думает';
  let hasFirstText = false;
  const spinnerText = () => {
    const elapsed = Date.now() - startedAt;
    const slowWarning = (elapsed > 20000 && !hasFirstText)
      ? chalk.yellow(' · долго: провайдер может быть перегружен')
      : '';
    return chalk.bold.hex('#38bdf8')(`Duddy ${phase}… `) +
      chalk.hex('#64748b')(`${formatDuration(elapsed)} · ${modelLabel()}`) +
      slowWarning +
      chalk.hex('#64748b')(' · Ctrl+C — прервать');
  };

  let spinner = ora({
    text: spinnerText(),
    color: 'cyan',
    spinner: 'dots12'
  }).start();

  const ticker = setInterval(() => {
    if (spinner && spinner.isSpinning) {
      spinner.text = spinnerText();
    }
  }, 1000);

  let turn = 0;

  try {
    while (true) {
      let startedStreaming = false;
      const renderer = new AnimatedTerminalRenderer();

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
        },
        onReasoning: () => {
          phase = 'рассуждает';
          if (!startedStreaming && spinner.isSpinning) {
            spinner.text = spinnerText();
          }
        },
        onChunk: (chunk) => {
          if (!startedStreaming) {
            if (!chunk.trim()) return;
            hasFirstText = true;
            spinner.stop();
            process.stdout.write(chalk.hex('#334155')('\n╭─ ') + chalk.bold.hex('#38bdf8')('✦ Duddy') + chalk.hex('#475569')(` [${modelLabel()}] `) + chalk.hex('#334155')('─'.repeat(26)) + '\n');
            startedStreaming = true;
          }
          renderer.push(chunk);
        },
        onWarning: (warningText) => {
          const wasSpinning = spinner.isSpinning;
          if (wasSpinning) {
            spinner.stop();
          }
          console.log(chalk.yellow(`⚠️  ${warningText}`));
          if (wasSpinning) {
            spinner.text = spinnerText();
            spinner.start();
          }
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

      if (startedStreaming) {
        await renderer.flush();
      }

      if (toolCalls && toolCalls.length > 0) {
        spinner.stop();

        if (turn >= MAX_TOOL_TURNS) {
          hitTurnLimit = true;
          console.log(chalk.yellow('⚠️  Достигнут лимит в 10 шагов инструментов — ход остановлен.'));
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

        for (let i = 0; i < toolCalls.length; i++) {
          const call = toolCalls[i];
          const funcName = call.function?.name || '';
          let funcArgs = {};
          let parseError = null;

          try {
            funcArgs = JSON.parse(call.function?.arguments || '{}');
          } catch (err) {
            parseError = err;
          }

          console.log(chalk.hex('#38bdf8')(`\n⚙️  [Инструмент: ${chalk.bold(funcName)}]`));

          let toolResultContent = '';
          if (parseError) {
            toolResultContent = `Ошибка: аргументы вызова ${funcName} — невалидный JSON (${parseError.message}). Повтори вызов с корректным JSON.`;
            console.log(chalk.red(`  ✖ ${toolResultContent}`));
          } else {
            const toolResult = await executeTool(funcName, funcArgs, activeToolCtx);
            toolResultContent = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
          }

          const toolMsg = {
            role: 'tool',
            tool_call_id: call.id,
            name: funcName,
            content: toolResultContent
          };
          messages.push(toolMsg);
          newMessages.push(toolMsg);
        }

        phase = 'анализирует результат';
        spinner = ora({
          text: spinnerText(),
          color: 'cyan',
          spinner: 'dots12'
        }).start();

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
  } finally {
    clearInterval(ticker);
    if (spinner && spinner.isSpinning) {
      spinner.stop();
    }
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
