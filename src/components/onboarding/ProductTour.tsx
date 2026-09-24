"use client";

import { Component, type ReactNode } from "react";

import TourDialog from "./TourDialog";
import type { TourDefinition } from "./tourSteps";
import type { ProductTourController } from "./useProductTour";

/**
 * Keeps a failing tour from taking the product with it.
 *
 * Onboarding is the least important thing on the page. If a step throws while
 * rendering, the overlay disappears and the application underneath — which
 * never depended on it — carries on untouched.
 */
class TourBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Product tour disabled after an error:", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Mount point for the guided tour.
 *
 * The controller is owned by the page so the header's replay control and this
 * dialog address the same tour; this component only renders it.
 */
export default function ProductTour({
  tour,
  controller,
}: {
  tour: TourDefinition;
  controller: ProductTourController;
}) {
  return (
    <TourBoundary>
      <TourDialog tour={tour} controller={controller} />
    </TourBoundary>
  );
}
