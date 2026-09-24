/**
 * Tour content.
 *
 * Configuration, not markup: a step is data, so adding one — or shipping a
 * short "what's new" tour beside this one — needs no component changes.
 *
 * Every claim here describes behaviour that exists today, and every visual is
 * a real capture of this application. Nothing is mocked up.
 */

export interface TourVisualAsset {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface TourStep {
  id: string;
  title: string;
  description: string;
  visual: TourVisualAsset;
  /** Small line under the image naming what is being shown. */
  caption?: string;
  /**
   * Optional selector for a live element to ring on the page behind. Purely
   * additive: a step whose target is absent renders exactly the same.
   */
  target?: string;
  /** Overrides the default "Next" label on the primary control. */
  primaryLabel?: string;
}

export interface TourDefinition {
  /** Persistence id. Bump it to re-introduce a changed tour. */
  id: string;
  /** Used by the replay control and the dialog's accessible name. */
  label: string;
  steps: TourStep[];
}

export const PRODUCT_TOUR: TourDefinition = {
  id: "v1",
  label: "Product tour",
  steps: [
    {
      id: "welcome",
      title: "Welcome to Solana Risk Radar",
      description:
        "Paste a Solana mint address and get an evidence-backed risk report built from live on-chain and market data. Nothing is predicted, and nothing is guessed.",
      primaryLabel: "Let's go",
      visual: {
        src: "/tour/welcome.webp",
        alt: "The Solana Risk Radar landing page, with the headline beside the token analyser",
        width: 2000,
        height: 688,
      },
      caption: "The landing analyser",
    },
    {
      id: "analyse",
      title: "Analyse any token",
      description:
        "Paste any SPL or Token-2022 mint to begin. Or start from one of the examples — USDC, BONK, JUP, ORCA — to see how reports differ across tokens. They are examples, not recommendations.",
      target: "[data-tour='analyser']",
      visual: {
        src: "/tour/analyse.webp",
        alt: "The mint address field, the Analyse button, and the Try chips for USDC, BONK, JUP and ORCA",
        width: 1617,
        height: 597,
      },
      caption: "Paste a mint, or try an example",
    },
    {
      id: "verdict",
      title: "A score, and the reason for it",
      description:
        "Fourteen deterministic rules across five equally weighted categories produce a 0–100 score and a plain-language verdict. It reports measurable risk signals — it never certifies a token as safe, or as a scam.",
      visual: {
        src: "/tour/verdict.webp",
        alt: "A report verdict: a risk score of 13 out of 100, the classification Low Risk Signals, and counts by severity",
        width: 2000,
        height: 848,
      },
      caption: "Score, verdict and severity counts",
    },
    {
      id: "coverage",
      title: "Coverage changes what a score means",
      description:
        "Coverage is how much of the analysis could actually be measured. A signal that cannot be read is excluded from the score rather than counted as clean — because unknown is not the same as safe.",
      visual: {
        src: "/tour/coverage.webp",
        alt: "The coverage section listing a signal that could not be measured and was excluded from the score",
        width: 2000,
        height: 560,
      },
      caption: "Excluded, not assumed clean",
    },
    {
      id: "evidence",
      title: "Every finding opens onto its evidence",
      description:
        "Each signal shows what was measured, what was found, and how many points it contributed. Inspect the evidence to follow any claim back to the chain.",
      visual: {
        src: "/tour/evidence.webp",
        alt: "Flagged signals ordered by contribution, each with a severity, an observed value and an inspect evidence link",
        width: 2000,
        height: 802,
      },
      caption: "Flagged signals, ranked by contribution",
    },
    {
      id: "liquidity",
      title: "Who can withdraw the liquidity",
      description:
        "Risk Radar reads LP custody pool by pool — burned, frozen, lock program or ordinary wallet — and states how much of the market it managed to measure. Locked liquidity is not a safety guarantee, and what cannot be measured is reported as unmeasured.",
      primaryLabel: "Start exploring",
      visual: {
        src: "/tour/liquidity.webp",
        alt: "The liquidity safety panel showing total liquidity, locked and withdrawable shares, and a Partial verification level",
        width: 2000,
        height: 784,
      },
      caption: "Liquidity safety, with its verification level",
    },
  ],
};
