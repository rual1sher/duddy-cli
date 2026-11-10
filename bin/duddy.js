#!/usr/bin/env node

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { loadConfig, getActiveApiKey, DEFAULT_SYSTEM_PROMPT, systemPromptFor } from "../src/config.js";
import { getProvider } from "../src/providers.js";
import { startTui } from "../src/ui/index.js";
import { runAgentTurn } from "../src/agent.js";
import { handleModelError, errorText } from "../src/errors.js";
import { createPlainRenderer } from "../src/plainRenderer.js";
import { formatDuration, formatTurnUsage } from "../src/formatter.js";
import { buildProjectContext } from "../src/projectContext.js";
import chalk from "chalk";
import { setTheme, paint } from "../src/theme.js";
import { isVoiceAvailable, speak } from "../src/voice/index.js";
import { runUpdate } from "../src/update.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const config = loadConfig();
  setTheme(config.theme);
  const provider = config.provider || "openrouter";
  const apiKey = getActiveApiKey(config);

  const rawArgs = process.argv.slice(2);

  // Handle flags
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    console.log(`
${paint('accent').bold("Duddy")} - Terminal AI Assistant for Linux & DevOps

${chalk.bold("Usage:")}
  ${paint('success')("duddy")}                       Start interactive chat session (like agy)
  ${paint('success')("duddy update")}                Обновить Duddy до последней версии
  ${paint('success')('duddy "your question"')}       Ask a quick one-off question
  ${paint('success')('cat error.log | duddy "explain"')} Analyze piped input

${chalk.bold("Options:")}
  ${paint('warning')("-s, --speak")} Озвучивать ответы модели голосом (TTS)
  ${paint('warning')("-y, --yes")}   Automatically confirm all tool actions without prompt
  ${paint('warning')("-h, --help")}  Show help
  ${paint('warning')("-v, --version")} Show version

${chalk.bold("Interactive Commands:")}
  ${paint('warning')("/update")}  Обновить Duddy до последней версии
  ${paint('warning')("/voice")}   Голосовой ввод или авто-озвучка (/voice on/off, Ctrl+S)
  ${paint('warning')("/model")}   Список моделей ваших провайдеров с поиском (включая локальную Ollama)
  ${paint('warning')("/effort")}  Set reasoning level (auto, low, medium, high)
  ${paint('warning')("/theme")}   Выбрать цветовую тему
  ${paint('warning')("/login")}   Login: OpenRouter, Google AI Studio or xAI
  ${paint('warning')("/clear")}   Clear conversation context
  ${paint('warning')("/context")} Show context window and history
  ${paint('warning')("/usage")}   Show model limits and token spend
  ${paint('warning')("/exit")}    Quit session
  ${paint('warning')("Shift+Tab")} Режим: обычный → правки без подтверждения → план → авто
`);
    process.exit(0);
  }

  if (rawArgs.includes("--version") || rawArgs.includes("-v")) {
    console.log(`duddy v${pkg.version}`);
    process.exit(0);
  }

  if (rawArgs.length === 1 && rawArgs[0] === "update") {
    const res = await runUpdate({
      onLine: (line) => console.log(chalk.dim(line)),
    });
    if (res.ok) {
      console.log(chalk.green(res.message));
      process.exit(0);
    } else {
      console.error(chalk.red(res.message));
      process.exit(1);
    }
  }

  let autoApprove = false;
  let autoSpeak = Boolean(config.voiceAutoSpeak);
  const args = [];
  for (const arg of rawArgs) {
    if (arg === "--yes" || arg === "-y") {
      autoApprove = true;
    } else if (arg === "--speak" || arg === "-s") {
      autoSpeak = true;
    } else {
      args.push(arg);
    }
  }

  const [fullContext, leanContext] = await Promise.all([
    buildProjectContext(process.cwd()),
    buildProjectContext(process.cwd(), { lean: true }),
  ]);

  const session = {
    id: randomUUID(),
    version: pkg.version,
    provider,
    apiKey,
    model:
      config.model ||
      config.models?.[provider] ||
      getProvider(provider).defaultModel,
    reasoningEffort: config.reasoningEffort || "auto",
    temperature: config.temperature ?? 0.4,
    systemPrompt: DEFAULT_SYSTEM_PROMPT + fullContext,
    systemPromptLean: DEFAULT_SYSTEM_PROMPT + leanContext,
    messages: [],
    autoApprove,
    autoSpeak,
  };

  // Check if data is being piped via stdin (e.g. cat file.log | duddy "explain")
  let pipedData = "";
  if (!process.stdin.isTTY) {
    pipedData = await readStdin();
  }

  // One-shot mode if arguments or piped data exist
  if (args.length > 0 || pipedData.trim()) {
    const userPrompt = args.join(" ");
    const combinedContent = pipedData.trim()
      ? `${userPrompt ? userPrompt + "\n\n" : ""}Context / Input:\n\`\`\`\n${pipedData.trim()}\n\`\`\``
      : userPrompt;

    if (!session.apiKey) {
      const p = getProvider(session.provider);
      const envHint = p.envVars.join(" или ");
      console.error(
        paint('error')(
          `Error: ${p.title} API key not configured. Run \`duddy\` interactively or set ${envHint}.`,
        ),
      );
      process.exit(1);
    }

    const interactive = process.stdin.isTTY === true;
    const renderer = createPlainRenderer(session, { interactive });
    const toolCtx = {
      autoApprove: !!session.autoApprove,
      allowCommands: !!session.autoApprove,
      canPrompt: interactive,
      ...renderer.toolCtxExtras,
    };

    const startTime = Date.now();
    const messagesToSend = [
      { role: "system", content: systemPromptFor(session) },
      { role: "user", content: combinedContent },
    ];

    const controller = new AbortController();
    const onSigint = () => {
      if (controller.signal.aborted) {
        process.exit(130);
      }
      controller.abort();
    };
    process.on("SIGINT", onSigint);

    try {
      const { turnUsage, elapsedMs, finalText } = await runAgentTurn({
        session,
        messages: messagesToSend,
        toolCtx,
        signal: controller.signal,
        events: renderer.events,
      });

      const durationStr = formatDuration(elapsedMs ?? Date.now() - startTime);
      const usageText = formatTurnUsage(turnUsage);
      const tokenInfo = usageText ? ` · ${usageText}` : "";
      console.log(
        paint('border')("╰─ ") +
          paint('success')("✔ Готово") +
          paint('subtle')(` · ${durationStr}${tokenInfo}\n`),
      );

      if (session.autoSpeak) {
        if (isVoiceAvailable()) {
          await speak(finalText);
        } else {
          console.error(paint('warning')('Голос не установлен — запустите duddy и выполните /voice install'));
        }
      }
    } catch (err) {
      if (controller.signal.aborted || err?.name === "AbortError") {
        console.error(paint('warning')("\nОстановлено"));
        process.exitCode = 130;
      } else {
        console.error(paint('error')(`\nError: ${errorText(err)}`));
        const hint = handleModelError(err, session);
        if (hint) console.error(paint('warning')(`↳ ${hint}`));
        process.exit(1);
      }
    } finally {
      process.off("SIGINT", onSigint);
      renderer.finish();
    }
    if (process.exitCode === 130) {
      process.exit(130);
    }
    return;
  }

  // If stdin is not TTY and no arguments or piped data provided
  if (!process.stdin.isTTY) {
    console.error(
      paint('warning')(
        'Интерактивный режим недоступен без TTY. Для разового запроса используйте: duddy "вопрос"',
      ),
    );
    process.exit(1);
  }

  // Default: Interactive TUI mode
  await startTui(session);
}

main().catch((err) => {
  console.error(paint('error')("Fatal error:"), err);
  process.exit(1);
});
