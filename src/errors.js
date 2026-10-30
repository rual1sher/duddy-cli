/**
 * @fileoverview Определение подсказок к ошибкам API и провайдеров
 */

import { noteModelError, UNAVAILABLE_REASONS } from './models/status.js';
import { getProvider } from './providers.js';

/**
 * Человекочитаемый текст ошибки: провайдеры кладут причину в JSON внутри message
 * (например «404 [{"error":{"message":"..."}}]»)
 *
 * @param {Error|object} err - Объект ошибки
 * @returns {string}
 */
export function errorText(err) {
  const raw = String(err?.message || err || '');
  const match = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return raw;
  let text = match[1];
  try {
    text = JSON.parse(`"${match[1]}"`);
  } catch {}
  const status = err?.status || (raw.match(/^(\d{3})\s/) || [])[1];
  return status ? `${status}: ${text}` : text;
}

/**
 * Разобрать ошибку хода: если модель недоступна для ключа надолго (тариф, регион,
 * отключена) — скрыть её из /model; вернуть подсказку для пользователя.
 *
 * @param {Error|object} err - Объект ошибки
 * @param {object} [session] - Текущая сессия Duddy
 * @returns {string|null} Текст подсказки или null
 */
export function handleModelError(err, session) {
  if (session?.provider && session?.model) {
    const reason = noteModelError(session.provider, session.model, err);
    if (reason) {
      return `Модель ${UNAVAILABLE_REASONS[reason]} — она скрыта из списка, выберите другую через /model`;
    }
  }
  return errorHint(err, session);
}

/**
 * Возвращает нейтральную подсказку для типичных ошибок API модели или null.
 *
 * @param {Error|object} err - Объект ошибки
 * @param {object} [session] - Текущая сессия Duddy
 * @returns {string|null} Текст подсказки или null
 */
export function errorHint(err, session) {
  if (!err) return null;

  const msg = (err.message || '').toLowerCase();
  const code = err.code || '';
  const status = err.status || err.statusCode || 0;

  if (code === 'FIRST_CHUNK_TIMEOUT' || code === 'STREAM_STALL_TIMEOUT') {
    return 'Повторите запрос, разбейте задачу на части или выберите другую модель через /model';
  }

  if (
    status === 503 ||
    msg.includes('503') ||
    msg.includes('high demand')
  ) {
    return 'Модель сейчас не отвечает или перегружена — повторите позже или выберите другую через /model';
  }

  if (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('free-models-per-day') ||
    msg.includes('rate limit')
  ) {
    return 'Превышен лимит запросов для этой модели — подождите или выберите другую через /model';
  }

  if (
    status === 402 ||
    msg.includes('402') ||
    msg.includes('credits') ||
    msg.includes('insufficient_quota')
  ) {
    return `На балансе ${getProvider(session?.provider).title} недостаточно средств — пополните счёт или выберите другую модель через /model`;
  }

  if (
    !session?.apiKey ||
    status === 401 ||
    status === 403 ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('неверный ключ') ||
    msg.includes('invalid api key') ||
    (status === 400 && (msg.includes('api key') || msg.includes('api_key') || msg.includes('ключ')))
  ) {
    return 'Ключ не подошёл — выполните /login';
  }

  if (
    status === 404 ||
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('no endpoints found') ||
    msg.includes('unavailable')
  ) {
    return 'Модель недоступна — выберите другую через /model';
  }

  return null;
}
