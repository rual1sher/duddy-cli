/** @fileoverview Описание инструментов агента для модели */

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create or overwrite file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: 'Create folder',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read file. Chunks via offset',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          start_line: { type: 'integer' },
          max_lines: { type: 'integer' },
          offset: { type: 'integer', description: 'Offset to continue' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace exact old_content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_content: { type: 'string', description: 'Exact text to replace' },
          new_content: { type: 'string' }
        },
        required: ['path', 'old_content', 'new_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_folder',
      description: 'Delete folder',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List folder contents',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run bash command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout_seconds: { type: 'number' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search text via ripgrep',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
          glob: { type: 'string' },
          case_insensitive: { type: 'boolean' },
          literal: { type: 'boolean' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files by pattern',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' }
        },
        required: ['pattern']
      }
    }
  }
];
