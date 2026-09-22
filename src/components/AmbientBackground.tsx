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
 * It is entirely CSS, and it no longer follows the pointer.
 *
 * It used to: each light source sat in a wrapper that translated a little with
 * the mouse. The trouble is that a light source is a radial gradient painted
 * inside a box, and those boxes were exactly viewport-sized — so each one's
 * edge ran down the edge of the screen at a point where the gradient itself
 * had not yet faded out. Sliding a box sideways dragged that cut inward and a
 * hard vertical line appeared in open space, which reads as a rendering fault
 * rather than as atmosphere.
 *
 * The horizontal following is gone, and the layers are now larger than the
 * screen, which puts their edges beyond the reach of the slow drift that
 * remains. The background still breathes; it no longer chases the cursor, and
 * there is nothing left for it to expose. Dropping the pointer listener and
 * its animation-frame loop also means an idle page does no work here at all.
 *
 * This is a server component now — there is no longer anything to hydrate.
 */
export default function AmbientBackground() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient-base" />

      <div className="ambient-glow ambient-glow-a" />
      <div className="ambient-glow ambient-glow-b" />
      <div className="ambient-glow ambient-glow-c" />

      <div className="ambient-grid" />
      <div className="ambient-frame" />
      <div className="ambient-grain" />
      <div className="ambient-vignette" />
    </div>
  );
}
