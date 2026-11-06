/** @fileoverview Накопление и сборка потоковых вызовов инструментов */

/**
 * Создать состояние для накопления потоковых вызовов инструментов (tool calls).
 *
 * @returns {{ calls: Array<object>, byIndex: Map<number, object> }}
 */
export function createToolCallState() {
  return {
    calls: [],
    byIndex: new Map()
  };
}

/**
 * Накопить дельту вызова инструмента (tool call) в состояние.
 * Поддерживает как стандартный OpenAI-формат с числовым индексом tc.index,
 * так и Google Gemini (OpenAI-compat), который не присылает index,
 * передавая отдельные вызовы с собственным id.
 *
 * @param {{ calls: Array<object>, byIndex: Map<number, object> }} state - Состояние накопления
 * @param {object} tc - Дельта вызова инструмента из chunk.choices[0].delta.tool_calls
 * @returns {object} Накопленный объект вызова инструмента
 */
export function accumulateToolCallDelta(state, tc) {
  let slot;
  if (typeof tc.index === 'number') {
    slot = state.byIndex.get(tc.index);
    if (!slot) {
      slot = {
        id: tc.id || '',
        type: tc.type || 'function',
        function: {
          name: tc.function?.name || '',
          arguments: ''
        }
      };
      state.calls.push(slot);
      state.byIndex.set(tc.index, slot);
    }
  } else {
    const lastCall = state.calls.length > 0 ? state.calls[state.calls.length - 1] : null;
    if (!lastCall || (tc.id && lastCall.id && lastCall.id !== tc.id)) {
      slot = {
        id: tc.id || '',
        type: tc.type || 'function',
        function: {
          name: tc.function?.name || '',
          arguments: ''
        }
      };
      state.calls.push(slot);
    } else {
      slot = lastCall;
    }
  }

  if (tc.id) slot.id = tc.id;
  if (tc.function?.name) {
    slot.function.name = tc.function.name;
  }
  if (tc.function?.arguments) {
    slot.function.arguments += tc.function.arguments;
  }
  if (tc.extra_content) {
    // Gemini 3.x требует сохранения extra_content (thought_signature) в истории для вызовов функций
    const prev = slot.extra_content;
    slot.extra_content = {
      ...prev,
      ...tc.extra_content,
      google: {
        ...prev?.google,
        ...tc.extra_content.google
      }
    };
  }

  return slot;
}

/**
 * Приведение строкового значения параметра по типу схемы инструмента.
 *
 * @param {*} val
 * @param {string} [propType]
 * @returns {*}
 */
function coerceValue(val, propType) {
  if (propType === 'integer' || propType === 'number') {
    if (typeof val === 'string' && val.trim() !== '') {
      const num = Number(val.trim());
      if (!Number.isNaN(num)) {
        return num;
      }
    }
    return val;
  }
  if (propType === 'boolean') {
    if (typeof val === 'string') {
      const lower = val.trim().toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
    }
    return val;
  }
  return val;
}

/**
 * Привести значение параметра инструмента по его JSON Schema свойствам.
 *
 * @param {object} toolDef
 * @param {string} paramName
 * @param {*} val
 * @returns {*}
 */
function coerceParam(toolDef, paramName, val) {
  const prop = toolDef?.parameters?.properties?.[paramName];
  if (!prop || !prop.type) return val;
  return coerceValue(val, prop.type);
}

/**
 * Извлечь содержимое из секций CDATA, если они присутствуют.
 *
 * @param {string} str
 * @returns {string}
 */
function unwrapCdata(str) {
  if (typeof str !== 'string') return str;
  const match = str.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (match) return match[1];
  if (str.includes('<![CDATA[')) {
    return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  }
  return str;
}

/**
 * Проверить формат 4: весь текст (или в единственном блоке ```json) является JSON-объектом вызова.
 *
 * @param {string} content
 * @param {Map<string, object>} toolMap
 * @returns {{ calls: Array<object>, rest: string }|null}
 */
function tryParseFormat4(content, toolMap) {
  if (typeof content !== 'string') return null;
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?```$/i);
  if (fenced) {
    text = fenced[1].trim();
  }
  if (!text.startsWith('{') || !text.endsWith('}')) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const name = parsed.name;
    if (typeof name !== 'string' || !toolMap.has(name)) {
      return null;
    }
    const rawArgs = parsed.arguments !== undefined ? parsed.arguments : parsed.parameters;
    let argsString;
    if (typeof rawArgs === 'string') {
      try {
        JSON.parse(rawArgs);
        argsString = rawArgs;
      } catch {
        return null;
      }
    } else if (typeof rawArgs === 'object' && rawArgs !== null) {
      argsString = JSON.stringify(rawArgs);
    } else if (rawArgs === undefined) {
      argsString = '{}';
    } else {
      return null;
    }
    return {
      calls: [{
        id: '',
        type: 'function',
        function: {
          name,
          arguments: argsString
        }
      }],
      rest: ''
    };
  } catch {
    return null;
  }
}

/**
 * Извлечь текстовые вызовы инструментов из ответа модели Ollama.
 * Поддерживает 4 формата:
 * 1. <function name="..."><param name="...">...</param></function> (minicpm)
 * 2. <function=...><parameter=...>...</parameter></function> (qwen3-coder)
 * 3. <tool_call>{"name": "...", "arguments": {...}}</tool_call> (hermes / qwen)
 * 4. Весь ответ — JSON-объект {"name": "...", "arguments": {...}}
 *
 * @param {string} content
 * @param {Array<object>} tools
 * @returns {{ calls: Array<object>, rest: string }}
 */
export function extractTextToolCalls(content, tools) {
  try {
    if (typeof content !== 'string' || !content.trim() || !Array.isArray(tools) || tools.length === 0) {
      return { calls: [], rest: content || '' };
    }

    const toolMap = new Map();
    for (const t of tools) {
      if (t?.function?.name) {
        toolMap.set(t.function.name, t.function);
      }
    }

    // Проверяем формат 4: всё содержимое представляет собой один JSON-объект
    const f4Result = tryParseFormat4(content, toolMap);
    if (f4Result) {
      return f4Result;
    }

    const matches = [];

    // Формат 1: <function name="..."><param name="...">...</param></function>
    const f1Regex = /<function\s+name=["']?([^"'>\s]+)["']?\s*>([\s\S]*?)<\/function>/gi;
    let m;
    while ((m = f1Regex.exec(content)) !== null) {
      const toolName = m[1];
      const toolDef = toolMap.get(toolName);
      if (!toolDef) continue;

      const inner = m[2];
      const args = {};
      const pRegex = /<param\s+name=["']?([^"'>\s]+)["']?\s*>([\s\S]*?)<\/param>/gi;
      let pm;
      while ((pm = pRegex.exec(inner)) !== null) {
        const pName = pm[1];
        let pVal = unwrapCdata(pm[2]);
        args[pName] = coerceParam(toolDef, pName, pVal);
      }
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        call: {
          id: '',
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(args)
          }
        }
      });
    }

    // Формат 2: <function=...><parameter=...>...</parameter></function>
    const f2Regex = /<function=(?:["']([^"']+)["']|([^>\s]+))>([\s\S]*?)<\/function>/gi;
    while ((m = f2Regex.exec(content)) !== null) {
      const toolName = m[1] || m[2];
      const toolDef = toolMap.get(toolName);
      if (!toolDef) continue;

      const inner = m[3];
      const args = {};
      const pRegex = /<parameter=(?:["']([^"']+)["']|([^>\s]+))>([\s\S]*?)<\/parameter>/gi;
      let pm;
      while ((pm = pRegex.exec(inner)) !== null) {
        const pName = pm[1] || pm[2];
        let pVal = pm[3].replace(/^\r?\n/, '').replace(/\r?\n$/, '');
        pVal = unwrapCdata(pVal);
        args[pName] = coerceParam(toolDef, pName, pVal);
      }
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        call: {
          id: '',
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(args)
          }
        }
      });
    }

    // Формат 3: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
    const f3Regex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    while ((m = f3Regex.exec(content)) !== null) {
      const inner = m[1].trim();
      let parsed;
      try {
        parsed = JSON.parse(inner);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const toolName = parsed.name;
      if (typeof toolName !== 'string' || !toolMap.has(toolName)) continue;

      const rawArgs = parsed.arguments !== undefined ? parsed.arguments : parsed.parameters;
      let argsString;
      if (typeof rawArgs === 'string') {
        try {
          JSON.parse(rawArgs);
          argsString = rawArgs;
        } catch {
          continue;
        }
      } else if (typeof rawArgs === 'object' && rawArgs !== null) {
        argsString = JSON.stringify(rawArgs);
      } else if (rawArgs === undefined) {
        argsString = '{}';
      } else {
        continue;
      }

      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        call: {
          id: '',
          type: 'function',
          function: {
            name: toolName,
            arguments: argsString
          }
        }
      });
    }

    if (matches.length === 0) {
      return { calls: [], rest: content };
    }

    matches.sort((a, b) => a.start - b.start);

    let rest = '';
    let lastIdx = 0;
    const filteredMatches = [];
    for (const match of matches) {
      if (match.start < lastIdx) continue;
      rest += content.slice(lastIdx, match.start);
      lastIdx = match.end;
      filteredMatches.push(match);
    }
    rest += content.slice(lastIdx);
    rest = rest.trim();

    return {
      calls: filteredMatches.map(m => m.call),
      rest
    };
  } catch {
    return { calls: [], rest: content };
  }
}
