"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { CallStatus } from "./use-vapi-call";

/*
 * "Spatial reverb" voice orb.
 *
 * - Orbits: two symmetric sets of tilted dot rings (outer and inner, turning in opposite
 *   directions) cross like orbits in 3D and slowly precess together. Nearer dots are larger and darker.
 * - Reverb: sound spawns dotted echo rings that travel outward and fade. Every burst leaves a
 *   short tail of quieter, delayed echoes, like a reverb tail.
 * - Spatial delay: each orbit reacts to the voice a little later than the one inside it, so the
 *   sound appears to move outward through the orbits.
 *
 * Brand direction: flat brand colours, thin dotted lines, no glow or gradients. Everything stays
 * still when the visitor prefers reduced motion.
 */

type RGB = readonly [number, number, number];
interface Palette {
  far: RGB; // far side of the orbits
  near: RGB; // near side of the orbits
  caller: RGB; // echoes of the caller's voice
  koya: RGB; // echoes of Koya's voice
}
const PALETTES: Record<"light" | "dark", Palette> = {
  // On light surfaces: deep blue (--brand) and teal blue (--accent).
  light: { far: [11, 42, 91], near: [8, 145, 178], caller: [11, 42, 91], koya: [8, 145, 178] },
  // On the deep-blue hero panel: soft blue-grey and light teal, still flat and calm.
  dark: { far: [120, 145, 190], near: [92, 198, 220], caller: [200, 214, 238], koya: [92, 198, 220] },
};

interface Orbit {
  radius: number; // fraction of the orb radius
  tilt: number; // inclination of the ring plane
  node: number; // rotation of the tilt axis
  speed: number; // radians per second (sign = direction)
  dots: number;
  delay: number; // seconds of lag in reacting to the voice
  phase: number;
}

// Two symmetric sets of rings, turned evenly around the view axis so the silhouette stays round
// and balanced at every moment: four outer rings 45° apart, three inner rings 60° apart. Moderate
// tilts keep each ring a wide ellipse, so together they trace a sphere-like cage, not an "atom" logo.
const QUARTER = Math.PI / 4;
const SIXTH = Math.PI / 3;
const ORBITS: Orbit[] = [
  ...[0, 1, 2, 3].map((i) => ({ radius: 0.95, tilt: 0.78, node: i * QUARTER, speed: 0.22, dots: 132, delay: 0.24, phase: i * 1.6 })),
  ...[0, 1, 2].map((i) => ({ radius: 0.58, tilt: 0.62, node: i * SIXTH + SIXTH / 2, speed: -0.36, dots: 84, delay: 0.1, phase: i * 2.1 + 1 })),
];
const PRECESSION = 0.05; // radians per second: the whole system turns slowly, keeping its symmetry

interface Echo {
  born: number;
  strength: number;
  color: RGB;
}

const ECHO_LIFE = 2.2; // seconds for an echo to travel out and fade
const TAIL = [
  { delay: 0, gain: 1 },
  { delay: 0.14, gain: 0.55 },
  { delay: 0.3, gain: 0.3 },
];

const rgba = (c: RGB, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Props {
  status: CallStatus;
  inCall: boolean;
  /** Koya's output level, 0–1. */
  volume: RefObject<number>;
  /** The caller's microphone level, 0–1. */
  micVolume: RefObject<number>;
  onToggle: () => void;
  disabled?: boolean;
  /** Which surface the orb sits on. */
  tone?: "light" | "dark";
  /** Wrapper sizing; defaults to a centred square. */
  className?: string;
  /** Diameter of the centre call button in px. */
  buttonSize?: number;
}

export function VoiceOrb({
  status,
  inCall,
  volume,
  micVolume,
  onToggle,
  disabled,
  tone = "light",
  className = "relative mx-auto aspect-square w-full max-w-[22rem]",
  buttonSize = 80,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ status, inCall });
  useEffect(() => {
    stateRef.current = { status, inCall };
  }, [status, inCall]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { far: FAR, near: NEAR, caller: CALLER, koya: KOYA } = PALETTES[tone];

    let frame = 0;
    let last = performance.now() / 1000;
    let clock = 0;
    let energy = 0; // smoothed voice level
    let lastSpawn = -10;
    const echoes: Echo[] = [];
    // Recent energy samples so outer orbits can react later than inner ones.
    const history: { t: number; e: number }[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const energyAt = (t: number) => {
      for (let i = history.length - 1; i >= 0; i--) if (history[i]!.t <= t) return history[i]!.e;
      return 0;
    };

    const spawn = (strength: number, color: RGB) => {
      for (const tap of TAIL) echoes.push({ born: clock + tap.delay, strength: strength * tap.gain, color });
      lastSpawn = clock;
    };

    const draw = () => {
      const now = performance.now() / 1000;
      const dt = Math.min(now - last, 0.064);
      last = now;
      const { status: s, inCall: active } = stateRef.current;
      const speaking = s === "speaking";

      if (!reduceMotion) {
        clock += dt;
        // Koya's level while Koya speaks, the microphone otherwise.
        const raw = active ? Math.min(1, (speaking ? volume.current : micVolume.current) ?? 0) : 0;
        energy += (raw - energy) * Math.min(1, dt * (raw > energy ? 14 : 4)); // quick attack, slow release
        history.push({ t: clock, e: energy });
        while (history.length && history[0]!.t < clock - 1) history.shift();

        const voiceColor = speaking ? KOYA : CALLER;
        if (active && energy > 0.06 && clock - lastSpawn > 0.55 - energy * 0.35) {
          spawn(0.35 + energy * 0.65, voiceColor);
        } else if (s === "connecting" && clock - lastSpawn > 1.1) {
          spawn(0.35, KOYA);
        } else if (!active && clock - lastSpawn > 4.5) {
          spawn(0.22, CALLER); // idle "breathing" so the orb reads as interactive
        }
      }

      const { width, height } = canvas.getBoundingClientRect();
      const cx = width / 2;
      const cy = height / 2;
      const R = Math.min(width, height) * 0.42;
      const core = R * 0.3; // the call button sits here
      ctx.clearRect(0, 0, width, height);

      // Reverb echoes: dotted rings travelling outward and fading.
      ctx.lineCap = "round";
      for (let i = echoes.length - 1; i >= 0; i--) {
        const e = echoes[i]!;
        const age = (clock - e.born) / ECHO_LIFE;
        if (age < 0) continue;
        if (age >= 1) {
          echoes.splice(i, 1);
          continue;
        }
        const eased = 1 - (1 - age) ** 2;
        ctx.strokeStyle = rgba(e.color, Math.min(1, e.strength * 1.1) * (1 - age) ** 1.3);
        ctx.lineWidth = 2.4 - age * 1.2;
        ctx.setLineDash([0.1, 4 + age * 5]);
        ctx.beginPath();
        ctx.arc(cx, cy, core + (R * 1.06 - core) * eased, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Orbits, back to front so near dots overlap far ones.
      const pts: { x: number; y: number; z: number; size: number }[] = [];
      for (const o of ORBITS) {
        const delayed = reduceMotion ? 0 : energyAt(clock - o.delay);
        const swell = 1 + delayed * 0.1 + (reduceMotion ? 0 : Math.sin(clock * 0.9 + o.phase) * 0.008);
        const r = R * o.radius * swell;
        const spin = o.phase + clock * o.speed * (active ? 1.6 : 1);
        const cosT = Math.cos(o.tilt);
        const sinT = Math.sin(o.tilt);
        const node = o.node + (reduceMotion ? 0 : clock * PRECESSION * (active ? 1.5 : 1));
        const cosN = Math.cos(node);
        const sinN = Math.sin(node);
        for (let k = 0; k < o.dots; k++) {
          const a = spin + (k / o.dots) * Math.PI * 2;
          // Circle in its own plane, tilted about the x-axis, then turned about the view axis.
          const x0 = Math.cos(a);
          const y0 = Math.sin(a) * cosT;
          const z = Math.sin(a) * sinT;
          const x = x0 * cosN - y0 * sinN;
          const y = x0 * sinN + y0 * cosN;
          const persp = 1 / (1 - z * 0.08); // very gentle perspective so the outline stays round
          pts.push({ x: cx + x * r * persp, y: cy + y * r * persp, z, size: (0.55 + (z + 1) * 0.6) * (1 + delayed * 0.6) });
        }
      }
      pts.sort((p, q) => p.z - q.z);
      for (const p of pts) {
        const depth = (p.z + 1) / 2;
        ctx.fillStyle = rgba(mix(FAR, NEAR, depth), 0.12 + depth * (active ? 0.75 : 0.55));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [volume, micVolume, tone]);

  const label = inCall ? "End call with Koya" : "Start a voice call with Koya";

  return (
    <div className={className}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={label}
        title={label}
        style={{ width: buttonSize, height: buttonSize }}
        className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:opacity-50 ${
          inCall
            ? tone === "dark"
              ? "border-accent-on-navy bg-accent-on-navy text-navy hover:bg-white"
              : "border-brand bg-brand text-white hover:bg-brand-hover"
            : tone === "dark"
              ? "border-navy-line bg-white text-brand hover:border-accent-on-navy"
              : "border-border bg-surface text-brand hover:border-brand"
        }`}
      >
        {inCall ? (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
            <rect x="7" y="7" width="10" height="10" rx="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        )}
      </button>
    </div>
  );
}

