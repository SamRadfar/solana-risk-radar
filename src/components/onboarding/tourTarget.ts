/**
 * Resolving the optional live element a step can point at.
 *
 * Every function here treats "not found" as an ordinary outcome. A step's
 * target is an enhancement, so a selector that matches nothing — or is not
 * even valid — must degrade to no highlight rather than throwing into render.
 */

export interface QueryRoot {
  querySelector(selector: string): Element | null;
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function defaultRoot(): QueryRoot | null {
  return typeof document === "undefined" ? null : document;
}

export function resolveTarget(
  selector: string | undefined,
  root: QueryRoot | null = defaultRoot(),
): Element | null {
  if (!selector || !root) return null;

  try {
    return root.querySelector(selector);
  } catch {
    // An invalid selector throws SyntaxError; that is a content bug, not a
    // reason to take the tour down.
    return null;
  }
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/**
 * Whether a highlight is worth drawing.
 *
 * The dialog sits in the middle of the screen, so a ring behind it would be
 * invisible at best and a stray glow at worst. The highlight is therefore only
 * drawn for targets that are clear of the dialog, and silently skipped
 * otherwise — the step's own visual already shows the same element.
 */
export function shouldHighlight(target: Rect | null, dialog: Rect | null): boolean {
  if (!target || target.width <= 0 || target.height <= 0) return false;
  if (!dialog) return true;
  return !rectsOverlap(target, dialog);
}
