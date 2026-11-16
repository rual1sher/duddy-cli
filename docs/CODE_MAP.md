# Карта кода Duddy

Короткая карта для человека: из каких частей состоит Duddy и что происходит, когда вы нажимаете Enter.
Подробные правила для агентов лежат в `AGENTS.md`, здесь только общая картина.

## Шесть частей

| Часть | Где лежит | Что делает | С чего читать |
| :--- | :--- | :--- | :--- |
| 1. Запуск | `bin/duddy.js` | Читает конфиг и флаги, собирает `session`, выбирает режим: чат (TUI) или разовый ответ | `main()` |
| 2. Экран | `src/ui/` | Рисует чат на Ink (React в терминале): история, поле ввода, диалоги | `App.js` |
| 3. Агент | `src/agent/` | Цикл «спросить модель → выполнить инструменты → спросить снова» | `runAgentTurn()` |
| 4. Модель | `src/llm/`, `src/session/config.js` | Запрос к OpenRouter или Ollama, потоковый ответ, системный промпт | `llm/stream.js` |
| 5. Инструменты | `src/tools/` | Файлы, поиск, bash, подтверждение опасных действий | `tools/execute.js` |
| 6. Каталог моделей | `src/models/` | Список моделей, их возможности, лимиты и статусы | `models/catalog.js` |

Остальные папки — помощники: `render/` (тема, форматирование текста, баннер), `session/` (конфиг, авторизация), `reports/` (отчёты `/usage` и `/context`), `images/` (картинки и буфер обмена), `update/` (проверка и установка обновлений).

## Путь одного сообщения

```
Enter в поле ввода
  │  src/ui/InputBox.js → PromptInput.js
  ▼
handleSend                         src/ui/hooks/useAgentTurn.js
  │  начинается с '/'  → команда   src/ui/hooks/useCommands.js
  │  иначе собирает: системный промпт + история (session.messages) + ваш текст
  ▼
runAgentTurn  ◄──────────────┐     src/agent/agent.js
  │  запрос к модели         │     src/llm/stream.js
  │                          │
  ├─ модель пишет текст ─────┼──►  события onText, onToolStart… → src/ui/hooks/turnEvents.js → экран
  │                          │
  └─ модель вызвала инструмент
       executeTool            │    src/tools/execute.js (таблица имя → функция)
         │ запись или bash?   │
         ▼                    │
       requestApproval        │    src/tools/approval.js → ctx.approve
         │                    │    диалог y/a/n: src/ui/hooks/useToolContext.js → Approval.js
         ▼                    │
       результат → снова к модели (не больше 10 шагов)
  ▼
commitTurn                         src/agent/history.js — ход сохраняется в session.messages
```

Разовый режим (`duddy "вопрос"` или `cat file | duddy`) идёт по тому же пути, только без экрана:
`bin/duddy.js` вызывает `runAgentTurn` сам, а печатает ответ `src/render/plainRenderer.js`.

## Где искать, если нужно…

| Задача | Файл |
| :--- | :--- |
| Поменять системный промпт | `src/session/config.js` |
| Добавить команду `/…` | `src/ui/commands/commands.js` (список) + `src/ui/commands/` (обработчик) + `src/ui/hooks/useCommands.js` |
| Добавить инструмент для модели | `src/tools/definitions.js` (описание) + `src/tools/execute.js` (таблица) |
| Решить, какая команда bash опасна | `src/tools/commandPolicy.js` (`classifyCommand`) |
| Какие файлы считаются секретными | `src/tools/sensitivePath.js`, `src/tools/secretScan.js` |
| Как выглядит строка инструмента в чате | `src/render/toolDisplay.js` (старт), `src/render/toolResultDisplay.js` (результат) |
| Цвета | `src/render/theme.js` |
| Текст ошибок API | `src/llm/errors.js` |
| Подключение к Ollama | `src/models/ollama.js`, `src/session/session-actions.js` (`connectOllama`) |
| Обновление Duddy | `src/update/update.js` (проверка), `src/update/updateInstall.js` (установка) |

## Что пока неудобно

- Многие файлы почти упёрлись в лимит 300 строк.
- Одна и та же логика местами повторяется (например, подсчёт времени хода в четырёх местах).

Это чиним по шагам, после каждого шага карта обновляется.
