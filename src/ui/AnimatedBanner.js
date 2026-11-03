/**
 * @fileoverview Живой баннер с пиксель-арт котёнком: интро и лёгкая анимация простоя
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { bannerLines } from '../banner.js';

const h = React.createElement;

const ANIMATED = Boolean(process.stdout.isTTY) && !process.env.DUDDY_NO_ANIMATION;

/**
 * Компонент живого анимированного баннера Duddy
 *
 * @param {object} props
 * @param {object} [props.session] - Текущая сессия Duddy
 * @returns {React.ReactElement}
 */
export function AnimatedBanner({ session }) {
  const [frame, setFrame] = useState(ANIMATED ? { rise: 6, reveal: 0 } : {});

  useEffect(() => {
    if (!ANIMATED) return;

    let cancelled = false;
    let timerId = null;

    // Шаги интро-анимации: [кадр, задержкаДоСледующегоШага]
    const introSteps = [];

    // 1. Появление снизу: rise 6 -> 0 с шагом в 45 мс
    for (let r = 5; r >= 0; r--) {
      introSteps.push([{ rise: r, reveal: 0 }, 45]);
    }

    // 2. Печатная машинка: reveal 0 -> 1 за 8 шагов по 30 мс
    for (let s = 1; s <= 8; s++) {
      introSteps.push([{ rise: 0, reveal: s / 8 }, 30]);
    }

    // 3. Приветственное моргание: закрыть глаза на 140 мс, затем открыть
    introSteps.push([{ rise: 0, reveal: 1, blink: true }, 140]);
    introSteps.push([{ rise: 0, reveal: 1, blink: false }, 0]);

    function scheduleIdle() {
      // Ожидание случайного интервала 3500-8000 мс перед следующим действием
      const waitMs = 3500 + Math.random() * 4500;
      timerId = setTimeout(() => {
        if (cancelled) return;
        // 75% вероятность моргания, иначе подёргивание правого ушка
        const isBlink = Math.random() < 0.75;
        if (isBlink) {
          setFrame({ rise: 0, reveal: 1, blink: true });
          timerId = setTimeout(() => {
            if (cancelled) return;
            setFrame({ rise: 0, reveal: 1, blink: false });
            scheduleIdle();
          }, 140);
        } else {
          setFrame({ rise: 0, reveal: 1, twitch: true });
          timerId = setTimeout(() => {
            if (cancelled) return;
            setFrame({ rise: 0, reveal: 1, twitch: false });
            scheduleIdle();
          }, 220);
        }
      }, waitMs);
    }

    let stepIndex = 0;
    function nextStep() {
      if (cancelled) return;
      if (stepIndex < introSteps.length) {
        const [nextFrame, delay] = introSteps[stepIndex++];
        setFrame(nextFrame);
        if (stepIndex < introSteps.length) {
          timerId = setTimeout(nextStep, delay);
        } else {
          scheduleIdle();
        }
      }
    }

    // Запуск первого шага интро через 35 мс
    timerId = setTimeout(nextStep, 35);

    return () => {
      cancelled = true;
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, []);

  const lines = bannerLines(
    {
      model: session?.model,
      provider: session?.provider,
      hasKey: Boolean(session?.apiKey)
    },
    frame
  );

  return h(
    Box,
    { flexDirection: 'column' },
    lines.map((line, i) => h(Text, { key: i }, line || ' '))
  );
}
