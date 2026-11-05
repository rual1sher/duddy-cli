/**
 * @fileoverview Хук периодического тикера для анимации и отсчёта времени
 */

import { useState, useEffect } from 'react';

/**
 * Хук периодического тикера
 *
 * @param {boolean} active - Активен ли тикер
 * @param {number} [intervalMs=80] - Интервал обновления в миллисекундах
 * @returns {{ tick: number, now: number }}
 */
export function useTicker(active, intervalMs = 80) {
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setTick(prev => prev + 1);
      setNow(Date.now());
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);

  return { tick, now };
}
