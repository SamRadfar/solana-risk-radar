"use client";

import { useEffect } from "react";

/**
 * The ambient background.
 *
 * A fixed, non-interactive stack of layers sitting behind all content:
 *
 *   1. base      — a deep vertical wash so the canvas is never flat black
 *   2. glow a/b  — two large, soft colour sources (cyan, indigo) that drift
 *   3. glow c    — a faint violet low on the page, slowly breathing
 *   4. grid      — a fine technical mesh, masked so it fades before the fold
 *   5. frame     — hairline rails at the content's max width, so the margins
 *                  on a wide monitor read as deliberate rather than empty
 *   6. grain     — a small noise tile that kills gradient banding
 *   7. vignette  — edge darkening that keeps the content dominant
 *
 * Everything is CSS. The only JavaScript is the pointer parallax below, which
 * writes two numbers to CSS custom properties; all movement is expressed as
 * `transform`, so it stays on the compositor and never triggers layout or
 * paint.
 */
export default function AmbientBackground() {
  usePointerParallax();

  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-base" />

      {/*
        Each moving layer is a parallax wrapper (driven by the pointer) around
        a drifting child (driven by a keyframe animation). They are split
        because a single element cannot hold both an animated transform and a
        variable-driven one.
      */}
      <div className="ambient-parallax" style={{ "--depth": "22px" } as React.CSSProperties}>
        <div className="ambient-glow ambient-glow-a" />
      </div>

      {/* Opposite depth sign gives the two sources genuine separation. */}
      <div className="ambient-parallax" style={{ "--depth": "-30px" } as React.CSSProperties}>
        <div className="ambient-glow ambient-glow-b" />
      </div>

      <div className="ambient-parallax" style={{ "--depth": "14px" } as React.CSSProperties}>
        <div className="ambient-glow ambient-glow-c" />
      </div>

      <div className="ambient-parallax" style={{ "--depth": "-8px" } as React.CSSProperties}>
        <div className="ambient-grid" />
      </div>

      <div className="ambient-frame" />
      <div className="ambient-grain" />
      <div className="ambient-vignette" />
    </div>
  );
}

/**
 * Pointer parallax.
 *
 * Writes `--pointer-x` / `--pointer-y` (each roughly -1…1) to the root element.
 * Three deliberate constraints keep it subconscious rather than gimmicky:
 *
 *   - a very low interpolation factor, so the background trails well behind
 *     the cursor instead of tracking it;
 *   - tiny per-layer ranges (8–30px), set in the markup above;
 *   - the rAF loop *stops* once the value has settled, so an idle page costs
 *     nothing at all.
 *
 * Disabled entirely for coarse pointers and for reduced-motion users, and both
 * preferences are watched live rather than read once.
 */
function usePointerParallax() {
  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let frame = 0;
    let running = false;
    let attached = false;

    const EASE = 0.04;
    const SETTLED = 0.0008;

    const tick = () => {
      currentX += (targetX - currentX) * EASE;
      currentY += (targetY - currentY) * EASE;

      root.style.setProperty("--pointer-x", currentX.toFixed(4));
      root.style.setProperty("--pointer-y", currentY.toFixed(4));

      if (
        Math.abs(targetX - currentX) > SETTLED ||
        Math.abs(targetY - currentY) > SETTLED
      ) {
        frame = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      // Ignore touch and pen: parallax is a desktop affordance only.
      if (event.pointerType !== "mouse") return;

      targetX = (event.clientX / window.innerWidth) * 2 - 1;
      targetY = (event.clientY / window.innerHeight) * 2 - 1;

      if (!running) {
        running = true;
        frame = requestAnimationFrame(tick);
      }
    };

    const detach = () => {
      if (!attached) return;
      window.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(frame);
      attached = false;
      running = false;
      // Ease back to centre rather than snapping.
      targetX = 0;
      targetY = 0;
      root.style.setProperty("--pointer-x", "0");
      root.style.setProperty("--pointer-y", "0");
    };

    const sync = () => {
      const shouldRun = finePointer.matches && !reducedMotion.matches;
      if (shouldRun && !attached) {
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        attached = true;
      } else if (!shouldRun) {
        detach();
      }
    };

    sync();
    finePointer.addEventListener("change", sync);
    reducedMotion.addEventListener("change", sync);

    return () => {
      finePointer.removeEventListener("change", sync);
      reducedMotion.removeEventListener("change", sync);
      detach();
    };
  }, []);
}
