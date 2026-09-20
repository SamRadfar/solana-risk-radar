import type { CategoryScore } from "@/lib/risk-engine/types";
import { scoreColor, scoreMeta } from "@/lib/severity";

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
 */
export default function CategoryProfile({
  categories,
}: {
  categories: CategoryScore[];
}) {
  return (
    <section id="profile" className="anchor card card-lit p-5 sm:p-6">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-[15px] font-semibold">Risk profile by category</h3>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          Equal weight · share of each category&rsquo;s measurable weight charged
        </p>
      </header>

      <ul className="mt-5 space-y-4">
        {categories.map((category) => {
          const measured = category.percent !== null;
          const percent = category.percent ?? 0;
          const color = measured ? scoreColor(percent) : "var(--ink-faint)";
          const meta = measured ? scoreMeta(percent) : null;

          return (
            <li key={category.category}>
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-2.5 min-w-0">
                  <span className="text-sm font-medium truncate">{category.category}</span>
                  <span
                    className="text-[11px] shrink-0"
                    style={{ color: "var(--ink-faint)" }}
                  >
                    {category.signalCount} signal{category.signalCount === 1 ? "" : "s"}
                  </span>
                </div>
                <span
                  className="tnum text-sm font-semibold shrink-0"
                  style={{ color: measured ? color : "var(--ink-muted)" }}
                >
                  {measured ? `${percent}%` : "not measured"}
                </span>
              </div>

              <div
                className="relative h-2.5 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.05)" }}
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
                    className="absolute top-0 bottom-0 w-px"
                    style={{ left: `${mark}%`, background: "rgba(255,255,255,0.07)" }}
                  />
                ))}

                {measured && percent > 0 && (
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${Math.max(percent, 1.5)}%`,
                      background: `linear-gradient(90deg, ${color}66 0%, ${color} 100%)`,
                      boxShadow: meta ? `0 0 12px -2px ${meta.glow}` : undefined,
                      transition: "width 1s cubic-bezier(0.16,1,0.3,1)",
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p
        className="mt-5 pt-4 text-[11px] leading-relaxed"
        style={{ borderTop: "1px solid var(--line)", color: "var(--ink-faint)" }}
      >
        Categories combine as a quadratic mean, not an average — clean dimensions cannot
        cancel out severe ones. One fully compromised category scores 45; two score 63.
      </p>
    </section>
  );
}
