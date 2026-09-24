/**
 * The tour's state machine.
 *
 * Kept pure and free of React so the navigation rules — which are the part
 * that can actually be wrong — are testable without a DOM. The component layer
 * only renders what this returns.
 */

export interface TourState {
  open: boolean;
  index: number;
}

export type TourAction =
  /** Opens at the first step, wherever the tour was left before. */
  | { type: "start" }
  | { type: "next"; total: number }
  | { type: "back" }
  | { type: "dismiss" };

export const initialTourState: TourState = { open: false, index: 0 };

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case "start":
      return { open: true, index: 0 };

    // Navigation is ignored while closed, so a stray arrow key can never
    // advance a tour that is not on screen.
    case "next": {
      if (!state.open) return state;
      const last = Math.max(0, action.total - 1);
      return { open: true, index: Math.min(state.index + 1, last) };
    }

    case "back": {
      if (!state.open) return state;
      return { open: true, index: Math.max(0, state.index - 1) };
    }

    case "dismiss":
      // The index is kept so a closing animation still has a step to paint.
      return { open: false, index: state.index };

    default:
      return state;
  }
}

export function isLastStep(index: number, total: number): boolean {
  return total > 0 && index >= total - 1;
}

export function isFirstStep(index: number): boolean {
  return index <= 0;
}

/** Human-readable position, e.g. "3 / 6". */
export function progressLabel(index: number, total: number): string {
  return `${Math.min(index + 1, total)} / ${total}`;
}
