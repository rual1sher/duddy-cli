/**
 * @fileoverview Помощники форматирования числовых значений, шкал и меток для отчётов
 */

import { paint } from '../render/theme.js';

/**
 * Создаёт текстовый индикатор прогресса (progress bar) заданной ширины
 *
 * @param {number} percent - Процент заполнения (0-100)
 * @param {number} [width=16] - Ширина шкалы в символах
 * @returns {string} Строка с цветным индикатором прогресса
 */
export function makeProgressBar(percent, width = 16) {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  const filled = Math.round((p / 100) * width);
  const empty = width - filled;

  let color = paint('success');
  if (p >= 80) {
    color = paint('error');
  } else if (p >= 50) {
    color = paint('warning');
  }

  return (
    color('█'.repeat(filled)) +
    paint('border')('░'.repeat(empty)) +
    ' ' +
    color((p + '%').padStart(4))
  );
}

/**
 * Вычисляет оставшееся время до полуночи UTC (момент сброса суточных лимитов)
 *
 * @returns {string} Строка вида "Чч Мм"
 */
export function getTimeUntilMidnightUTC() {
  const now = new Date();
  const nextUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  const diffMs = nextUTC.getTime() - now.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}ч ${mins}м`;
}

/**
 * Форматирует метку времени в локальный формат ЧЧ:ММ
 *
 * @param {number} ts - Метка времени в миллисекундах
 * @returns {string}
 */
export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Форматирует число с разделением тысяч по правилам русской локали
 *
 * @param {number|string|null|undefined} n - Число для форматирования
 * @returns {string}
 */
export function formatCount(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

/**
 * Форматирует строку отказа 429 с пропуском отсутствующих полей
 *
 * @param {object} hit - Запись об отказе
 * @returns {string}
 */
export function formatQuotaHit(hit) {
  if (!hit) return '';
  const parts = [];
  if (hit.limit != null && hit.metric) {
    parts.push(`лимит ${hit.limit} (${hit.metric})`);
  } else if (hit.limit != null) {
    parts.push(`лимит ${hit.limit}`);
  } else if (hit.metric) {
    parts.push(hit.metric);
  }
  if (hit.retryAfterSec != null) {
    parts.push(`повтор через ${hit.retryAfterSec} с`);
  }
  const timeStr = hit.at ? ` в ${formatTime(hit.at)}` : '';
  const details = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  return `Отказ 429${timeStr}${details}`;
}

/**
 * Разбирает ключ модели вида "<provider>:<modelId>" по первому двоеточию
 *
 * @param {string} key - Строка ключа модели
 * @returns {{ provider: string, modelId: string }}
 */
export function parseModelKey(key) {
  const idx = key.indexOf(':');
  if (idx === -1) {
    return { provider: '', modelId: key };
  }
  return {
    provider: key.slice(0, idx),
    modelId: key.slice(idx + 1)
  };
}
