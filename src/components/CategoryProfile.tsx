import type { CategoryScore } from "@/lib/risk-engine/types";
import { scoreColor } from "@/lib/severity";

/**
 * The token's risk profile across categories.
 *
 * The reader's job here is to compare magnitudes across five named categories,
 * which is a bar chart's job — a radar/spider plot would distort area, depend
 * on arbitrary axis order, and make precise comparison harder, all to look
 * more impressive. Bars are read accurately at a glance, which is the whole
 * point of the five-second promise.
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
    <section
      className="rounded-2xl border p-5 sm:p-6"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      aria-labelledby="risk-profile-heading"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 id="risk-profile-heading" className="text-sm font-semibold">
          Risk profile by category
        </h3>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Share of each category&rsquo;s measurable weight that was charged
        </p>
      </div>

      <ul className="mt-5 space-y-3.5">
        {categories.map((category) => {
          const measured = category.percent !== null;
          const percent = category.percent ?? 0;
          const color = measured ? scoreColor(percent) : "var(--muted)";

          return (
            <li key={category.category} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-sm truncate">{category.category}</span>
                <span className="text-[11px] shrink-0" style={{ color: "var(--muted)" }}>
                  {category.signalCount} signal{category.signalCount === 1 ? "" : "s"}
                </span>
              </div>

              <span
                className="tnum text-sm font-medium text-right"
                style={{ color: measured ? color : "var(--muted)" }}
              >
                {measured ? `${percent}%` : "not measured"}
              </span>

              <div
                className="col-span-2 h-2 rounded-full overflow-hidden"
                style={{ background: "var(--surface-3)" }}
                role="img"
                aria-label={
                  measured
                    ? `${category.category}: ${percent} percent of measurable risk weight charged`
                    : `${category.category}: not measured`
                }
              >
                {measured && (
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(percent, percent > 0 ? 1.5 : 0)}%`,
                      background: color,
                      transition: "width 0.9s cubic-bezier(0.16,1,0.3,1)",
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
