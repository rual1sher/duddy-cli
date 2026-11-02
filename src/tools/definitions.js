/** @fileoverview Описание инструментов агента для модели */

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Создать новый файл или полностью перезаписать существующий файл с указанным содержимым. Используйте для создания новых файлов или для полной перезаписи (когда меняется весь файл или большая его часть). Автоматически создает родительские папки. Файлы длиннее 40000 символов и файлы не в UTF-8 не перезаписывает: для них используйте edit_file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Имя и относительный путь к файлу (например: "index.html" или "src/utils.js"). Не передавайте имя папки или "."'
          },
          content: {
            type: 'string',
            description: 'Полное содержимое файла'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: 'Создать новую папку (директорию). Автоматически создает все недостающие родительские папки.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к папке, например: "src/components" или "assets/icons"'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Прочитать текстовое содержимое существующего файла. Если нужна только часть, передайте start_line и max_lines: это намного дешевле. За один вызов возвращает до 40000 символов. Если файл длиннее, в конце результата указано, как продолжить.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к файлу для чтения, например: "package.json"'
          },
          start_line: {
            type: 'integer',
            description: 'С какой строки читать, считая с 1. Номера строк даёт инструмент grep.'
          },
          max_lines: {
            type: 'integer',
            description: 'Сколько строк вернуть, по умолчанию 200, если указан start_line.'
          },
          offset: {
            type: 'integer',
            description: 'С какого символа читать, если результат подсказал offset. Нельзя совмещать со start_line.'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Точечно заменить небольшой фрагмент существующего текста в файле (old_content) на новый фрагмент (new_content). Для полной перезаписи всего файла используйте create_file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Имя и относительный путь к файлу (например: "index.html" или "src/utils.js")'
          },
          old_content: {
            type: 'string',
            description: 'Точный непрерывный фрагмент существующего текста из файла, который нужно заменить. Для лучшего совпадения предварительно прочитайте файл через read_file.'
          },
          new_content: {
            type: 'string',
            description: 'Новый текст, который заменит old_content'
          }
        },
        required: ['path', 'old_content', 'new_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Удалить файл из файловой системы.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к удаляемому файлу'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_folder',
      description: 'Удалить папку (директорию) и всё её содержимое.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к удаляемой папке'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Получить список файлов и подпапок в указанной директории.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к директории (по умолчанию "." для текущей рабочей папки)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Выполнить команду bash в рабочей папке: тесты, сборка, линтер, git. Для чтения и поиска используйте read_file, grep и glob, они дешевле. Команда работает без терминала и ввода: интерактивные программы, серверы и наблюдатели запускать нельзя. Возвращает вывод и код выхода.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Текст команды, например "npm test"'
          },
          timeout_seconds: {
            type: 'number',
            description: 'Лимит времени в секундах, по умолчанию 120, максимум 600'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Поиск по содержимому файлов. Использует регулярное выражение как в ripgrep, возвращает строки с номерами, это самый дешёвый способ найти код, скрытые файлы и .gitignore пропускаются. Шаблон строчными буквами ищется без учёта регистра.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Регулярное выражение или текст для поиска'
          },
          path: {
            type: 'string',
            description: 'Папка или файл для поиска (по умолчанию "." для текущей рабочей папки)'
          },
          glob: {
            type: 'string',
            description: 'Glob-фильтр файлов, например "*.js" или "src/**/*.ts". Шаблон "src/*.js" не заходит в подпапки.'
          },
          case_insensitive: {
            type: 'boolean',
            description: 'Искать без учёта регистра'
          },
          literal: {
            type: 'boolean',
            description: 'Искать шаблон как точный текст, а не регулярное выражение'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Поиск файлов по glob-шаблону с учётом .gitignore.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob-шаблон для поиска файлов (например "src/**/*.js")'
          },
          path: {
            type: 'string',
            description: 'Папка для поиска (по умолчанию "." для текущей рабочей папки)'
          }
        },
        required: ['pattern']
      }
    }
  }
];
