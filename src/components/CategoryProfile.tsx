import type { CategoryScore } from "@/lib/risk-engine/types";
import { scoreColor, scoreMeta } from "@/lib/severity";

import CategoryHelp from "./CategoryHelp";
import Reveal from "./Reveal";
import SectionHead from "./SectionHead";
import styles from "./CategoryProfile.module.css";

/**
 * The token's risk profile across categories.
 *
 * The reader's job here is to compare magnitudes across five named categories,
 * which is a bar chart's job — a radar plot would distort area, depend on
 * arbitrary axis order and make precise comparison harder, all to look more
 * impressive. Bars are read accurately at a glance, which is the point.
 *
 * Magnitude is carried by bar length (a non-colour channel); colour only
 * reinforces it, and every row is labelled with its exact value.
 *
 * The section carries no card. It is a chart, and a chart does not need a
 * rounded rectangle around it to be understood — the headline, the rule
 * beneath it and the space either side mark where it begins and ends. Freed
 * from the card's padding, the bars run the full width of the column, which is
 * also what makes them readable at a glance.
 */
export default function CategoryProfile({
  categories,
}: {
  categories: CategoryScore[];
}) {
  const measurable = categories.filter((category) => category.percent !== null).length;

  return (
    <section id="profile" className="anchor">
      <SectionHead
        eyebrow="Risk profile"
        title="Risk profile by category"
        caption="Each bar is the share of that category's own measurable weight that was charged. All five carry equal weight in the score."
        meta={
          <>
            {measurable} of {categories.length} measurable
          </>
        }
      />

      <Reveal as="ul" className={styles.rows}>
        {categories.map((category) => {
          const measured = category.percent !== null;
          const percent = category.percent ?? 0;
          const color = measured ? scoreColor(percent) : "var(--ink-faint)";
          const meta = measured ? scoreMeta(percent) : null;

          return (
            <li key={category.category} className={styles.row}>
              <div className={styles.label}>
                <span className={styles.name}>
                  {category.category}
                  {/* Only the icon is interactive; the row itself stays inert. */}
                  <CategoryHelp category={category.category} />
                </span>
                <span className={styles.count}>
                  {category.signalCount} signal{category.signalCount === 1 ? "" : "s"}
                </span>
              </div>

              <div className={styles.readout}>
                {measured ? (
                  <>
                    <span className={`tnum ${styles.value}`} style={{ color }}>
                      {percent}
                      <span className={styles.unit}>%</span>
                    </span>
                    {meta && (
                      <span className={styles.level} style={{ color }}>
                        <span aria-hidden="true">{meta.glyph}</span> {meta.label}
                      </span>
                    )}
                  </>
                ) : (
                  <span className={styles.absent}>not measured</span>
                )}
              </div>

              <div
                className={styles.track}
                role="img"
                aria-label={
                  measured
                    ? `${category.category}: ${percent} percent of measurable risk weight charged`
                    : `${category.category}: not measured`
                }
              >
                {/* Quartile reference marks — turns a bar into a scale. */}
                {[25, 50, 75].map((mark) => (
                  <span
                    key={mark}
                    aria-hidden="true"
                    className={styles.mark}
                    style={{ left: `${mark}%` }}
                  />
                ))}

                {measured && percent > 0 && (
                  <span
                    className={styles.fill}
                    style={{
                      /*
                       * Held as a scale rather than a width so growing the bar
                       * on reveal stays on the compositor. The floor keeps a
                       * small but non-zero charge visible.
                       */
                      "--fill": Math.max(percent / 100, 0.015),
                      background: `linear-gradient(90deg, ${color}66 0%, ${color} 100%)`,
                      boxShadow: meta ? `0 0 14px -3px ${meta.glow}` : undefined,
                    } as React.CSSProperties}
                  />
                )}
              </div>
            </li>
          );
        })}
      </Reveal>

      <p className={styles.note}>
        Categories combine as a quadratic mean, not an average — clean dimensions cannot
        cancel out severe ones. One fully compromised category scores 45; two score 63.
      </p>
    </section>
  );
}
