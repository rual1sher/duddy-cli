/** @fileoverview Описание инструментов агента для модели */

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a file or fully overwrite an existing one. Creates parent folders. Will not overwrite files over 40000 chars or non-UTF-8 files: use edit_file for those.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative file path, e.g. "index.html" or "src/utils.js". Not a folder or "."'
          },
          content: {
            type: 'string',
            description: 'Full file content'
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
      description: 'Create a folder, including missing parent folders.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Folder path, e.g. "src/components"'
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
      description: 'Read a text file. For part of a file pass start_line and max_lines: much cheaper. Returns up to 40000 chars per call; if the file is longer, the result says how to continue.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path, e.g. "package.json"'
          },
          start_line: {
            type: 'integer',
            description: '1-based line to start from. grep gives line numbers.'
          },
          max_lines: {
            type: 'integer',
            description: 'Number of lines to return, default 200 when start_line is set.'
          },
          offset: {
            type: 'integer',
            description: 'Character offset to continue from, when the result suggests it. Not combined with start_line.'
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
      description: 'Replace a small exact fragment of a file (old_content) with new_content. For full rewrites use create_file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative file path, e.g. "src/utils.js"'
          },
          old_content: {
            type: 'string',
            description: 'Exact contiguous text from the file to replace. Read the file with read_file first.'
          },
          new_content: {
            type: 'string',
            description: 'Replacement text'
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
      description: 'Delete a file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path'
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
      description: 'Delete a folder and everything in it.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Folder path'
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
      description: 'List files and subfolders of a folder.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Folder path, default "."'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a bash command in the project folder: tests, builds, linters, git. To read and search use read_file, grep and glob: they are cheaper. No terminal or input: no interactive programs, servers or watchers. Returns output and exit code.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Command, e.g. "npm test"'
          },
          timeout_seconds: {
            type: 'number',
            description: 'Time limit in seconds, default 120, max 600'
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
      description: 'Search file contents with a ripgrep regex. Returns matching lines with line numbers: the cheapest way to find code. Skips hidden and .gitignore files. An all-lowercase pattern is case-insensitive.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex or text to find'
          },
          path: {
            type: 'string',
            description: 'Folder or file to search, default "."'
          },
          glob: {
            type: 'string',
            description: 'File filter, e.g. "*.js" or "src/**/*.ts". "src/*.js" does not enter subfolders.'
          },
          case_insensitive: {
            type: 'boolean',
            description: 'Ignore case'
          },
          literal: {
            type: 'boolean',
            description: 'Treat pattern as plain text, not a regex'
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
      description: 'Find files by glob pattern, respecting .gitignore.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern, e.g. "src/**/*.js"'
          },
          path: {
            type: 'string',
            description: 'Folder to search, default "."'
          }
        },
        required: ['pattern']
      }
    }
  }
];
