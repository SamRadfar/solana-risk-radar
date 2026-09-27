import Reveal from "./Reveal";
import styles from "./SignalLanes.module.css";

/**
 * The five risk dimensions, presented as one instrument rather than five
 * feature cards.
 *
 * Of the compositions considered — a horizontal spectrum bar that expands on
 * hover, and an arc echoing the score dial — this one was chosen because the
 * other two hide or distort the text. A judge scanning the page should be able
 * to read all five questions without hovering anything and without the layout
 * fighting them on a laptop.
 *
 * The structure carries the meaning: one signal line, five nodes on it, and
 * dividers only *between* sectors. Nothing is boxed.
 */

const LANES: { title: string; question: string }[] = [
  {
    title: "Authorities",
    question: "Can supply still be minted, wallets frozen, or transfers intercepted? Cross-checked by RugCheck.",
  },
  {
    title: "Holders",
    question: "How much of the sellable supply sits in the largest wallets?",
  },
  {
    title: "Liquidity",
    question: "Is there a real market deep enough to exit into?",
  },
  {
    title: "Market Activity",
    question: "Is trading healthy, dormant, or suspiciously inflated?",
  },
  {
    title: "Maturity",
    question: "How long has the oldest measured liquidity pool existed?",
  },
];

export default function SignalLanes() {
  return (
    <section className={styles.section} aria-labelledby="what-gets-checked">
      <Reveal as="header" className={styles.head}>
        <h2 id="what-gets-checked" className="eyebrow">
          What gets checked
        </h2>
        <p className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
          Five dimensions · 13 on-chain signals + 1 external cross-check
        </p>
      </Reveal>

      <div className={styles.rail}>
        <div className={styles.line} aria-hidden="true" />

        <Reveal as="ol" stagger step={80} delay={120} className={styles.lanes}>
          {LANES.map((lane, index) => {
            const number = String(index + 1).padStart(2, "0");
            return (
              <li key={lane.title} className={styles.lane} tabIndex={0}>
                <span className={styles.ghost} aria-hidden="true">
                  {number}
                </span>
                <span className={styles.node} aria-hidden="true" />

                <span className={styles.index}>{number}</span>
                <h3 className={styles.title}>{lane.title}</h3>
                <p className={styles.question}>{lane.question}</p>
              </li>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
