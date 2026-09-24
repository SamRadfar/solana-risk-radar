"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import {
  initialTourState,
  isFirstStep,
  isLastStep,
  progressLabel,
  tourReducer,
} from "./tourMachine";
import {
  hasSeenTour,
  resolveStorage,
  writeTourRecord,
  type StorageLike,
} from "./tourStorage";
import type { TourDefinition, TourStep } from "./tourSteps";

export interface ProductTourController {
  open: boolean;
  index: number;
  total: number;
  step: TourStep | null;
  isFirst: boolean;
  isLast: boolean;
  progress: string;
  next: () => void;
  back: () => void;
  /** Finishes the tour and records it as completed. */
  finish: () => void;
  /** Dismisses the tour and records it as skipped. */
  skip: () => void;
  /** Reopens from the first step, whatever was recorded before. */
  replay: () => void;
}

/**
 * Owns the tour's lifecycle: whether to auto-open, where in the sequence the
 * user is, and how the tour ended.
 *
 * The auto-open decision deliberately runs in an effect rather than during
 * render, so the server and the first client paint agree and the dialog can
 * never cause a hydration mismatch.
 */
export function useProductTour(tour: TourDefinition): ProductTourController {
  const [state, dispatch] = useReducer(tourReducer, initialTourState);
  const storageRef = useRef<StorageLike | null>(null);

  const total = tour.steps.length;

  useEffect(() => {
    storageRef.current = resolveStorage();

    // No steps means nothing to show — and no storage means we cannot tell
    // whether this tour was already dismissed. Showing it on every visit would
    // be worse than not showing it, so it stays closed and the header's
    // replay control remains the way in.
    if (total === 0 || storageRef.current === null) return;

    if (!hasSeenTour(storageRef.current, tour.id)) {
      dispatch({ type: "start" });
    }
  }, [tour.id, total]);

  const record = useCallback(
    (outcome: "completed" | "skipped") => {
      // Closing first means a storage failure can never leave the tour stuck
      // on screen.
      dispatch({ type: "dismiss" });
      writeTourRecord(storageRef.current, tour.id, outcome);
    },
    [tour.id],
  );

  const next = useCallback(() => dispatch({ type: "next", total }), [total]);
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const finish = useCallback(() => record("completed"), [record]);
  const skip = useCallback(() => record("skipped"), [record]);
  const replay = useCallback(() => dispatch({ type: "start" }), []);

  const index = Math.min(state.index, Math.max(0, total - 1));

  return useMemo(
    () => ({
      open: state.open && total > 0,
      index,
      total,
      step: tour.steps[index] ?? null,
      isFirst: isFirstStep(index),
      isLast: isLastStep(index, total),
      progress: progressLabel(index, total),
      next,
      back,
      finish,
      skip,
      replay,
    }),
    [state.open, index, total, tour.steps, next, back, finish, skip, replay],
  );
}
