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
 */
export default function LandingHero({
  onAnalyze,
  loading,
}: {
  onAnalyze: (address: string) => void;
  loading: boolean;
}) {
  return (
    <section className="relative rise">
      {/*
        The connective tissue: one soft light source centred between the
        columns, bleeding under both. Purely decorative and inert — the ambient
        background system is untouched and still runs behind all of this.
      */}
      <div
        aria-hidden="true"
        /*
          Kept inside the section's own box: bleeding it sideways widened the
          document and introduced horizontal scroll on narrow viewports. The
          radial falloff already carries the light past the columns visually.
        */
        className="pointer-events-none absolute inset-x-0 -top-20 bottom-0 -z-10"
        style={{
          background:
            "radial-gradient(48% 52% at 62% 28%, rgba(56,214,236,0.10) 0%, transparent 70%), radial-gradient(42% 48% at 88% 16%, rgba(99,102,241,0.12) 0%, transparent 72%)",
        }}
      />

      <div className="grid items-start gap-10 lg:gap-14 lg:grid-cols-[1.18fr_0.82fr]">
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
      <span
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
        14 deterministic signals · 5 risk categories
      </span>

      {/*
        Left-aligned and set considerably larger than the old centred version.
        The line break is authored rather than left to wrapping, so the gradient
        always lands on the second line at every width.
      */}
      <h1
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
      </h1>

      <p
        className="mt-6 text-[15px] sm:text-base leading-relaxed max-w-[46ch]"
        style={{ color: "var(--ink-secondary)" }}
      >
        Paste a Solana mint address and get an explainable risk report in seconds.
      </p>

      <ul className="mt-6 space-y-2.5">
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
      </ul>
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
     * Frameless by design.
     *
     * This was a `card`, which painted rgba(19,22,32,0.72) — a 72%-opaque dark
     * rectangle — straight over the hero's ambient light, so the gradient
     * visibly stopped at the panel edges and the right half read as a separate
     * block pasted on top. There is now no fill, no border and no lit edge:
     * just a radial wash that fades to fully transparent before it reaches any
     * edge, so the hero's atmosphere passes through uninterrupted and the
     * group reads as floating in the same scene.
     *
     * The lg offset drops the panel so its top sits with the headline rather
     * than 79px above it, balancing it against the left column's visual mass.
     */
    <div className="relative lg:mt-16 p-5 sm:p-7">
      {/*
        The light is an ellipse, not a box shadow. A box-shadow — however soft —
        is painted around the element's rectangle, which is what was still
        reading as a block behind the analyser. This gradient reaches full
        transparency at 76% of its radii, well inside its own bounds, so it has
        no edges and no corners to see.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 64% at 50% 34%, rgba(255,255,255,0.055) 0%, rgba(126,214,236,0.022) 44%, transparent 76%)",
        }}
      />

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
    </div>
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
