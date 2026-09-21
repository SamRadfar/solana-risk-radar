import type { CategoryScore, RiskCategory } from "./risk-engine/types";

/**
 * Attribution: where the measured risk actually came from.
 *
 * This is a *view* over results the engine has already produced. It computes
 * nothing about risk — no rule runs here, no threshold is applied, and the
 * score is not touched. It only re-expresses `CategoryScore[]` as shares of the
 * total points charged, which is a question the report could not previously
 * answer.
 *
 * That question is deliberately different from the one the category profile
 * answers. The profile shows *intensity*: how much of each category's own
 * measurable weight was charged, which is what the score aggregates. This shows
 * *composition*: of everything that was charged anywhere, how much came from
 * each category. A category can be intense and still be a small part of the
 * whole, and the two readings together are what "what shaped this verdict"
 * means.
 *
 * The sentence is generated from the numbers by fixed rules. No model is
 * involved in deciding what it says.
 */

export interface CategoryContribution {
  category: RiskCategory;
  /** Points this category charged. */
  points: number;
  /** Exact share of all charged points, 0-1 — used for bar geometry. */
  share: number;
  /** Share as a whole percent. These sum to exactly 100 across the set. */
  sharePercent: number;
  /** Risk within the category, 0-100. The figure the score aggregates. */
  percent: number;
  signalCount: number;
}

export interface Interpretation {
  /** Measured categories, largest contributor first. */
  contributions: CategoryContribution[];
  /** Categories where nothing could be measured at all. */
  unmeasured: RiskCategory[];
  /** Total points charged across every measured category. */
  totalPoints: number;
  /** One deterministic sentence describing the composition above. */
  sentence: string;
  /**
   * The same finding compressed to a headline. Short enough to be set large,
   * which is the only reason it exists separately from `sentence`.
   */
  statement: string;
}

/**
 * Display copy, kept separate from the engine's own phrase table.
 *
 * The engine phrases categories for a sentence about thresholds ("partially
 * offset by renounced authorities"). These phrase them for a sentence about
 * where risk came from, which needs a different shape — a source noun and a
 * bare adjective that can take "signals". Sharing one table would force both
 * sentences to bend toward each other.
 */
const CATEGORY_LANGUAGE: Record<RiskCategory, { source: string; plain: string }> = {
  Authorities: { source: "authority risk", plain: "authority" },
  Holders: { source: "holder concentration", plain: "holder" },
  Liquidity: { source: "liquidity risk", plain: "liquidity" },
  "Market Activity": { source: "trading-activity risk", plain: "market-activity" },
  Maturity: { source: "maturity risk", plain: "maturity" },
};

/** At or above this combined share, the leaders are "most of" the risk. */
const MAJORITY_SHARE = 0.6;
/** At or above this, a single category is effectively the whole story. */
const DOMINANT_SHARE = 0.85;
/** Below this top share, no category leads and the risk reads as spread. */
const SPREAD_SHARE = 0.4;
/** At or below this share, a contributing category is a rounding detail. */
const MINOR_SHARE = 0.1;
/** Naming more than this many leaders stops being a summary. */
const MAX_LEADERS = 3;
/**
 * There are five categories and at least one of them is charged whenever this
 * clause is built, so four is every clean category there can be — the clause
 * never has to elide one.
 */
const MAX_CLEAN_NAMED = 4;

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Rounds shares to whole percents that still sum to 100.
 *
 * Rounding each share on its own lets the displayed figures add up to 99 or
 * 101, which is exactly the kind of detail a sceptical reader checks first.
 * The largest-remainder method hands the leftover points to the values that
 * were rounded down hardest, so the set stays honest.
 */
function distributePercents(shares: number[]): number[] {
  const scaled = shares.map((share) => share * 100);
  const floors = scaled.map(Math.floor);
  const used = floors.reduce((sum, value) => sum + value, 0);
  let remaining = Math.round(shares.reduce((sum, s) => sum + s, 0) * 100) - used;

  const order = scaled
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const result = [...floors];
  for (const { index } of order) {
    if (remaining <= 0) break;
    result[index] += 1;
    remaining -= 1;
  }
  return result;
}

export function interpretCategories(categories: CategoryScore[]): Interpretation {
  const measured = categories.filter(
    (category): category is CategoryScore & { percent: number } => category.percent !== null,
  );
  const unmeasured = categories
    .filter((category) => category.percent === null)
    .map((category) => category.category);

  const totalPoints = measured.reduce((sum, category) => sum + category.points, 0);

  // Largest contributor first; ties break on intensity, then on name, so the
  // order is stable for the same report rather than dependent on input order.
  const ranked = [...measured].sort(
    (a, b) =>
      b.points - a.points ||
      b.percent - a.percent ||
      a.category.localeCompare(b.category),
  );

  const shares = ranked.map((category) =>
    totalPoints > 0 ? category.points / totalPoints : 0,
  );
  const percents = totalPoints > 0 ? distributePercents(shares) : shares.map(() => 0);

  const contributions: CategoryContribution[] = ranked.map((category, index) => ({
    category: category.category,
    points: category.points,
    share: shares[index],
    sharePercent: percents[index],
    percent: category.percent,
    signalCount: category.signalCount,
  }));

  return {
    contributions,
    unmeasured,
    totalPoints,
    sentence: buildSentence(contributions, totalPoints, unmeasured.length),
    statement: buildStatement(contributions, totalPoints),
  };
}

/**
 * The headline form.
 *
 * Deliberately one clause: it is set at display size, and a second clause at
 * that size stops being a headline and becomes a paragraph. The qualifying
 * detail lives in `sentence` directly beneath it.
 */
function buildStatement(
  contributions: CategoryContribution[],
  totalPoints: number,
): string {
  if (contributions.length === 0) return "Nothing could be measured.";
  if (totalPoints === 0) return "Every measured category came back clean.";

  const charged = contributions.filter((c) => c.points > 0);
  const top = charged[0];

  if (top.share < SPREAD_SHARE && charged.length > 2) {
    return "No single category dominated this result.";
  }

  return `${top.sharePercent}% of measured risk came from ${CATEGORY_LANGUAGE[top.category].source}.`;
}

function buildSentence(
  contributions: CategoryContribution[],
  totalPoints: number,
  unmeasuredCount: number,
): string {
  if (contributions.length === 0) {
    return "No category could be measured, so there is no risk to attribute.";
  }

  if (totalPoints === 0) {
    return unmeasuredCount > 0
      ? "Every category that could be measured came back clean, so none of them shaped the score."
      : "Every category came back clean, so no category shaped the score.";
  }

  const charged = contributions.filter((c) => c.points > 0);
  const clean = contributions.filter((c) => c.points === 0);
  const cleanClause = buildCleanClause(clean, charged);

  // No single category leads: describing one as the cause would misrepresent
  // an evenly spread result.
  if (charged[0].share < SPREAD_SHARE && charged.length > 2) {
    const top = charged[0];
    return `The measured risk is spread across ${charged.length} categories rather than concentrated in one, led by ${CATEGORY_LANGUAGE[top.category].source} at ${top.sharePercent}% of everything charged${cleanClause}.`;
  }

  const leaders: CategoryContribution[] = [];
  let accumulated = 0;
  for (const contribution of charged) {
    if (accumulated >= MAJORITY_SHARE || leaders.length >= MAX_LEADERS) break;
    leaders.push(contribution);
    accumulated += contribution.share;
  }

  const leaderPercent = leaders.reduce((sum, c) => sum + c.sharePercent, 0);
  const names = joinList(leaders.map((c) => CATEGORY_LANGUAGE[c.category].source));

  if (leaders.length === 1) {
    const opening =
      leaders[0].share >= DOMINANT_SHARE
        ? "Nearly all of the measured risk came from"
        : "Most of the measured risk came from";
    return `${opening} ${names}, at ${leaderPercent}% of everything charged${cleanClause}.`;
  }

  return `Most of the measured risk came from ${names} — together ${leaderPercent}% of everything charged${cleanClause}.`;
}

function buildCleanClause(
  clean: CategoryContribution[],
  charged: CategoryContribution[],
): string {
  if (clean.length > 0) {
    const names = joinList(
      clean.slice(0, MAX_CLEAN_NAMED).map((c) => CATEGORY_LANGUAGE[c.category].plain),
    );
    return `, while ${names} signals stayed clean`;
  }

  // Nothing was fully clean, but the tail may still be negligible — worth
  // saying, because it tells the reader where *not* to look.
  const minor = charged.filter((c) => c.share <= MINOR_SHARE);
  if (minor.length > 0 && minor.length < charged.length) {
    const names = joinList(
      minor.slice(0, MAX_CLEAN_NAMED).map((c) => CATEGORY_LANGUAGE[c.category].plain),
    );
    return `, while ${names} signals contributed comparatively little`;
  }

  return "";
}
