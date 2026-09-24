"use client";

import Image from "next/image";
import { useState } from "react";

import styles from "./ProductTour.module.css";
import type { TourStep } from "./tourSteps";

/**
 * The product visual beside the copy.
 *
 * A missing or unloadable asset collapses the frame rather than leaving a
 * broken image or a hole in the layout — the step still reads on its own, and
 * the tour is never blocked by a file that failed to ship.
 */
export default function TourVisual({ step }: { step: TourStep }) {
  // TourDialog keys this subtree on the step id, so every step arrives with a
  // fresh `failed` and gets its own chance to load.
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <figure className={styles.visual}>
      <span className={styles.visualFrame}>
        <Image
          src={step.visual.src}
          alt={step.visual.alt}
          width={step.visual.width}
          height={step.visual.height}
          className={styles.visualImage}
          onError={() => setFailed(true)}
          priority={step.id === "welcome"}
          sizes="(max-width: 860px) 92vw, 44vw"
        />
      </span>
      {step.caption && <figcaption className={styles.caption}>{step.caption}</figcaption>}
    </figure>
  );
}
