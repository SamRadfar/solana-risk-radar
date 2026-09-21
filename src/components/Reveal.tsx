"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
} from "react";

import styles from "./Reveal.module.css";

/**
 * Reveals its content the first time it reaches the viewport, once per page
 * session.
 *
 * It renders *as* the element it is given rather than wrapping it, so adding
 * motion to an existing composition adds no DOM and changes no layout: the
 * class and the data attribute land on the element that was already there.
 *
 * Content that is already on screen when the page loads is not made to wait
 * for a scroll — it plays its entrance immediately. Only content below the
 * fold is observed, and each observer disconnects the moment it fires, so a
 * fully-read page holds none.
 */

type RevealProps = HTMLAttributes<HTMLElement> & {
  /** The element to render. Defaults to a div. */
  as?: ElementType;
  /** Milliseconds to hold before this element starts. */
  delay?: number;
  /** Reveal direct children in sequence instead of this element as a block. */
  stagger?: boolean;
  /** Milliseconds between staggered children. */
  step?: number;
  /** Travel distance in pixels. Overrides the responsive default. */
  distance?: number;
};

export default function Reveal({
  as: Tag = "div",
  delay = 0,
  stagger = false,
  step,
  distance,
  className,
  style,
  children,
  ...rest
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Reduced motion is owned entirely by the stylesheet, which shows every
    // reveal regardless of this state. So the work to skip here is the
    // observer itself: none is created, nothing is ever scheduled, and the
    // element simply renders.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Already visible at load. Flipping on the next frame rather than in this
    // one is what gives the browser a hidden frame to transition from.
    if (element.getBoundingClientRect().top < window.innerHeight) {
      const frame = requestAnimationFrame(() => setRevealed(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        setRevealed(true);
        // One-shot: scrolling away and back must not replay it, and a revealed
        // element should cost nothing for the rest of the session.
        observer.disconnect();
      },
      // A little into the viewport, so content animates as it is reached
      // rather than in the corner of the eye.
      { rootMargin: "0px 0px -8% 0px", threshold: 0 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const motionStyle = {
    "--reveal-delay": `${delay}ms`,
    ...(step !== undefined ? { "--reveal-step": `${step}ms` } : {}),
    ...(distance !== undefined ? { "--reveal-distance": `${distance}px` } : {}),
    ...style,
  } as CSSProperties;

  return (
    <Tag
      ref={ref}
      data-reveal={revealed ? "in" : "out"}
      className={[stagger ? styles.staggerHost : styles.reveal, className]
        .filter(Boolean)
        .join(" ")}
      style={motionStyle}
      {...rest}
    >
      {children}
    </Tag>
  );
}
