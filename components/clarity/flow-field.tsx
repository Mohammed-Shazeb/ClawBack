"use client";

import { useEffect, useRef } from "react";

/**
 * Black & white flowing-thread texture.
 * Hundreds of particles drift through a slowly evolving flow field,
 * leaving soft white trails on black. Pure canvas, no dependencies.
 */
export function FlowField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    type P = { x: number; y: number; px: number; py: number; speed: number; alpha: number };
    let particles: P[] = [];

    const spawn = (): P => {
      const x = Math.random() * width;
      const y = Math.random() * height;
      return {
        x,
        y,
        px: x,
        py: y,
        speed: 0.4 + Math.random() * 0.9,
        alpha: 0.09 + Math.random() * 0.28,
      };
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      const count = Math.min(420, Math.floor((width * height) / 3200));
      particles = Array.from({ length: count }, spawn);
    };

    // Layered-sine pseudo noise field: smooth, flowy, slowly rotating.
    const field = (x: number, y: number, t: number) => {
      const s = 0.0016;
      return (
        Math.sin(x * s * 1.7 + t * 0.12) +
        Math.cos(y * s * 1.3 - t * 0.09) +
        Math.sin((x + y) * s * 0.7 + t * 0.05) * 1.2
      ) * Math.PI * 0.55;
    };

    let t = 0;
    const step = () => {
      t += 0.016;
      ctx.fillStyle = "rgba(0,0,0,0.035)";
      ctx.fillRect(0, 0, width, height);

      ctx.lineWidth = 1;
      ctx.lineCap = "round";

      for (const p of particles) {
        const a = field(p.x, p.y, t);
        p.px = p.x;
        p.py = p.y;
        p.x += Math.cos(a) * p.speed * 1.6;
        p.y += Math.sin(a) * p.speed * 1.6;

        if (p.x < -10 || p.x > width + 10 || p.y < -10 || p.y > height + 10) {
          Object.assign(p, spawn());
          continue;
        }

        ctx.strokeStyle = `rgba(255,255,255,${p.alpha})`;
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      raf = requestAnimationFrame(step);
    };

    resize();
    step();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
