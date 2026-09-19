"use client";

import { useEffect, useRef, useState } from "react";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function useCountUp(target: number, duration = 900, delay = 0) {
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * easeOut(t)));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(() => {
      frame.current = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target, duration, delay]);

  return value;
}

export function CountUp({
  value,
  duration,
  delay,
  prefix = "$",
}: {
  value: number;
  duration?: number;
  delay?: number;
  prefix?: string;
}) {
  const current = useCountUp(value, duration, delay);
  return (
    <span className="numeral">
      {prefix}
      {current.toLocaleString("en-US")}
    </span>
  );
}
