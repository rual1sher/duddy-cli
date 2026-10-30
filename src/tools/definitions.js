/** @fileoverview Описание инструментов агента для модели */

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Создать новый файл или полностью перезаписать существующий файл с указанным содержимым. Используйте для создания новых файлов или для полной перезаписи (когда меняется весь файл или большая его часть). Автоматически создает родительские папки.',
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
      description: 'Прочитать текстовое содержимое существующего файла.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к файлу для чтения, например: "package.json"'
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
  }
];
