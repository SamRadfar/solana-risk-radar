import styles from "./SiteFooter.module.css";

/**
 * The footer.
 *
 * Concept: the end of an analytical scan. A dark radar surface recedes to a
 * lit horizon, light travels across it, and a slow wave sweeps toward the
 * viewer — the product's one atmospheric moment, placed where a reader has
 * finished reading rather than where they are trying to.
 *
 * It is a pure CSS scene: a 3D-transformed grid plane, three gradient light
 * layers and a veil. No JavaScript, no canvas, no images, and every animated
 * property is `transform` or `opacity`, so the whole thing lives on the
 * compositor. Styles are scoped in a CSS Module, which keeps the global
 * stylesheet and the ambient background system untouched.
 */
export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.scene} aria-hidden="true">
        {/* Perspective surface, furthest back. */}
        <div className={styles.stage}>
          <div className={styles.plane}>
            <div className={styles.lines} />
          </div>
        </div>

        {/* Fades the floor into the canvas — an overlay, not a mask (see CSS). */}
        <div className={styles.floorFade} />

        {/* The light the surface recedes into. */}
        <div className={styles.horizon} />
        <div className={styles.horizonLine} />

        {/* One slow wave travelling out of the horizon. */}
        <div className={styles.sweep} />

        {/* Legibility, then the seam that dissolves into the page above. */}
        <div className={styles.veil} />
        <div className={styles.seam} />
        <div className={styles.seamLine} />
      </div>

      <div className={styles.content}>
        <p className={styles.wordmark}>Solana Risk Radar</p>
        <p className={styles.tagline}>Deterministic signals. Verifiable evidence.</p>

        <div className={styles.rule} aria-hidden="true" />

        <p className={styles.credit}>
          Built for Superteam Germany &mdash; Road to Colosseum
        </p>

        <p className={styles.provenance}>
          On-chain data from Solana RPC and the Metaplex / Token-2022 metadata
          standards. Market data from DexScreener.
        </p>
      </div>
    </footer>
  );
}
