import Reveal from "./Reveal";
import { BackgroundRippleEffect } from "./ui/background-ripple-effect";
import TokenInputForm from "./TokenInputForm";

/**
 * The landing hero.
 *
 * An asymmetric split: the argument on the left, the action on the right. The
 * landing page and the analysis page are deliberately different spaces — this
 * one is product-led and expressive, the report is dense and evidence-first —
 * so this composition is scoped to the entry state and never wraps a result.
 *
 * The two halves are held together rather than merely placed side by side:
 * they share a top alignment and vertical rhythm, and the analyser panel sits
 * in a glow that bleeds left underneath the message, so the eye reads one
 * composition with two jobs instead of two unrelated boxes.
 *
 * The composition is unchanged; only its arrival is staged. Each element
 * renders as itself with a reveal attached, so nothing here is wrapped and no
 * box, margin or grid track moves.
 */
export default function LandingHero({
  onAnalyze,
  loading,
}: {
  onAnalyze: (address: string) => void;
  loading: boolean;
}) {
  return (
    <section className="relative">
      {/*
        No hero-local background layer by design.
        
        There used to be a "connective" glow here, spanning the section box.
        Because that box is the 1120px content column, and the gradient was
        still near full strength when it reached the box's right edge, the
        light was sliced off in a straight vertical line right beside the
        analyser — the seam that made the right half look like a separate
        block. Measured as the strongest persistent vertical edge in the whole
        hero; removing this layer removed it entirely.

        The atmosphere now comes solely from the global ambient background,
        which is fixed and full-viewport and therefore has no edge anywhere on
        screen to cut against.
      */}
      {/*
        Aceternity background ripple, layered ABOVE the global ambient gradient
        (fixed, full-viewport, rendered by AmbientBackground) and BELOW the hero
        content. Subtle (35%) and radially masked so it is strongest centre-right
        and fades out behind the headline and before every edge of this box, so
        it can never cut a straight seam against the gradient.
      */}
      <div
        className="dark absolute inset-0 z-0 overflow-hidden opacity-35"
        style={{
          maskImage: "radial-gradient(ellipse 55% 75% at 66% 45%, #000 15%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 55% 75% at 66% 45%, #000 15%, transparent 100%)",
        }}
        aria-hidden="true"
      >
        <BackgroundRippleEffect rows={12} cols={27} />
      </div>
      {/* 56/44 — the analyser needs enough width to show a full 44-character
          mint address without the field scrolling. */}
      <div className="pointer-events-none relative z-10 grid items-start gap-10 lg:gap-16 lg:grid-cols-[56fr_44fr] [&>*]:pointer-events-auto">
        <Message />
        <Analyser onAnalyze={onAnalyze} loading={loading} />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Message() {
  const points = [
    "Real on-chain and market data",
    "Transparent, deterministic scoring",
    "Evidence behind every signal",
  ];

  return (
    <div className="lg:pt-6">
      <Reveal
        as="span"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px]"
        style={{
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.03)",
          color: "var(--ink-secondary)",
        }}
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent-glow)" }}
        />
        13 on-chain signals + RugCheck cross-check · 5 risk categories
      </Reveal>

      {/*
        Left-aligned and set considerably larger than the old centred version.
        The line break is authored rather than left to wrapping, so the gradient
        always lands on the second line at every width.
      */}
      <Reveal
        as="h1"
        delay={90}
        /*
          The base size is set so "Know a token's risk" still holds one line at
          390px; at 42px it wrapped and orphaned "risk" above the gradient line,
          which broke the authored two-line structure.
        */
        className="mt-6 display font-semibold text-[34px] sm:text-[52px] lg:text-[64px]"
        style={{ color: "#fff" }}
      >
        Know a token&rsquo;s risk
        <br />
        <span className="grad-text">before you touch it</span>
      </Reveal>

      <Reveal
        as="p"
        delay={180}
        className="mt-6 text-[15px] sm:text-base leading-relaxed max-w-[46ch]"
        style={{ color: "var(--ink-secondary)" }}
      >
        Paste a Solana mint address and get an explainable risk report in seconds.
      </Reveal>

      <Reveal as="ul" stagger delay={260} step={80} className="mt-6 space-y-2.5">
        {points.map((point) => (
          <li key={point} className="flex items-center gap-3 text-[14px]">
            <span
              aria-hidden="true"
              className="h-5 w-5 rounded-md shrink-0 flex items-center justify-center text-[10px]"
              style={{
                background: "rgba(56,214,236,0.09)",
                border: "1px solid var(--line)",
                color: "var(--accent)",
              }}
            >
              ✓
            </span>
            <span style={{ color: "var(--ink)" }}>{point}</span>
          </li>
        ))}
      </Reveal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Analyser({
  onAnalyze,
  loading,
}: {
  onAnalyze: (address: string) => void;
  loading: boolean;
}) {
  return (
    /*
     * Completely unframed: no fill, no border, no wash, no shadow — just the
     * interface elements sitting directly on the hero. Every enclosing surface
     * this block has had (an opaque card, then a box-shadow, then a radial
     * haze) reintroduced a rectangle behind the analyser, so there is now no
     * enclosing surface at all. The glass field below is the only treated
     * element.
     *
     * The lg offset drops the group so its top sits with the headline rather
     * than 79px above it, balancing it against the left column's visual mass.
     */
    <Reveal delay={240} className="relative lg:mt-16 p-5 sm:p-7">
      <h2 className="text-[17px] font-semibold">Analyse a token</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
        Paste a Solana mint address to inspect its risk signals.
      </p>

      <div className="mt-5">
        <TokenInputForm onAnalyze={onAnalyze} loading={loading} glass stack />
      </div>

      {/*
        A hairline that fades at both ends rather than spanning edge to edge,
        so it separates without drawing another rectangle.
      */}
      <div
        aria-hidden="true"
        className="mt-6 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.09) 22%, rgba(255,255,255,0.09) 78%, transparent)",
        }}
      />

      <div
        className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px]"
        style={{ color: "var(--ink-muted)" }}
      >
        <Trust>No wallet required</Trust>
        <Trust>Evidence-backed</Trust>
      </div>
    </Reveal>
  );
}

function Trust({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" style={{ color: "var(--accent)" }}>
        ✓
      </span>
      {children}
    </span>
  );
}
