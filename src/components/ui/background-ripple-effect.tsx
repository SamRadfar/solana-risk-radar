"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const BackgroundRippleEffect = ({
  rows = 8,
  cols = 27,
  cellSize = 56,
}: {
  rows?: number;
  cols?: number;
  cellSize?: number;
}) => {
  const [clickedCell, setClickedCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [rippleKey, setRippleKey] = useState(0);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Hover is resolved from pointer coordinates rather than per-cell :hover:
  // the hero content sits above the grid and would otherwise swallow the
  // pointer over most cells. Mouse only, so touch never leaves a stuck cell.
  useEffect(() => {
    let current: number | null = null;
    let last: { x: number; y: number } | null = null;
    const update = (next: number | null) => {
      if (next !== current) {
        current = next;
        setHoveredCell(next);
      }
    };
    const resolve = () => {
      const root = ref.current, grid = gridRef.current;
      if (!last || !root || !grid) return update(null);
      const box = root.getBoundingClientRect();
      if (last.x < box.left || last.x >= box.right || last.y < box.top || last.y >= box.bottom) return update(null);
      const r = grid.getBoundingClientRect();
      const col = Math.floor((last.x - r.left) / cellSize), row = Math.floor((last.y - r.top) / cellSize);
      update(row >= 0 && row < rows && col >= 0 && col < cols ? row * cols + col : null);
    };
    const onMove = (e: PointerEvent) => {
      last = e.pointerType === "mouse" ? { x: e.clientX, y: e.clientY } : null;
      resolve();
    };
    const onLeave = () => {
      last = null;
      update(null);
    };
    const html = document.documentElement;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", resolve, { passive: true });
    window.addEventListener("blur", onLeave);
    html.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", resolve);
      window.removeEventListener("blur", onLeave);
      html.removeEventListener("mouseleave", onLeave);
    };
  }, [rows, cols, cellSize]);

  return (
    <div
      ref={ref}
      className={cn(
        "absolute inset-0 h-full w-full",
        "[--cell-border-color:var(--color-neutral-300)] [--cell-fill-color:var(--color-neutral-100)] [--cell-shadow-color:var(--color-neutral-500)]",
        "dark:[--cell-border-color:var(--color-neutral-700)] dark:[--cell-fill-color:var(--color-neutral-900)] dark:[--cell-shadow-color:var(--color-neutral-800)]",
      )}
    >
      <div className="relative h-auto w-auto overflow-hidden">
        <div className="pointer-events-none absolute inset-0 z-[2] h-full w-full overflow-hidden" />
        <DivGrid
          key={`base-${rippleKey}`}
          className="mask-radial-from-20% mask-radial-at-top opacity-600"
          rows={rows}
          cols={cols}
          cellSize={cellSize}
          borderColor="var(--cell-border-color)"
          fillColor="var(--cell-fill-color)"
          clickedCell={clickedCell}
          hoveredCell={hoveredCell}
          gridRef={gridRef}
          onCellClick={(row, col) => {
            setClickedCell({ row, col });
            setRippleKey((k) => k + 1);
          }}
          interactive
        />
      </div>
    </div>
  );
};

type DivGridProps = {
  className?: string;
  rows: number;
  cols: number;
  cellSize: number; // in pixels
  borderColor: string;
  fillColor: string;
  clickedCell: { row: number; col: number } | null;
  hoveredCell?: number | null;
  gridRef?: React.Ref<HTMLDivElement>;
  onCellClick?: (row: number, col: number) => void;
  interactive?: boolean;
};

type CellStyle = React.CSSProperties & {
  ["--delay"]?: string;
  ["--duration"]?: string;
};

const DivGrid = ({
  className,
  rows = 7,
  cols = 30,
  cellSize = 56,
  borderColor = "#3f3f46",
  fillColor = "rgba(14,165,233,0.3)",
  clickedCell = null,
  hoveredCell = null,
  gridRef,
  onCellClick = () => {},
  interactive = true,
}: DivGridProps) => {
  const cells = useMemo(
    () => Array.from({ length: rows * cols }, (_, idx) => idx),
    [rows, cols],
  );

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
    width: cols * cellSize,
    height: rows * cellSize,
    marginInline: "auto",
  };

  return (
    <div ref={gridRef} className={cn("relative z-[3]", className)} style={gridStyle}>
      {cells.map((idx) => {
        const rowIdx = Math.floor(idx / cols);
        const colIdx = idx % cols;
        const distance = clickedCell
          ? Math.hypot(clickedCell.row - rowIdx, clickedCell.col - colIdx)
          : 0;
        const delay = clickedCell ? Math.max(0, distance * 55) : 0; // ms
        const duration = 200 + distance * 80; // ms

        const style: CellStyle = clickedCell
          ? {
              "--delay": `${delay}ms`,
              "--duration": `${duration}ms`,
            }
          : {};

        return (
          <div
            key={idx}
            className={cn(
              "cell relative border-[0.5px] transition-opacity duration-200 ease-out will-change-transform dark:shadow-[0px_0px_40px_1px_var(--cell-shadow-color)_inset]",
              hoveredCell === idx ? "opacity-100" : "opacity-30",
              clickedCell && "animate-cell-ripple [animation-fill-mode:none]",
              !interactive && "pointer-events-none",
            )}
            style={{
              backgroundColor: fillColor,
              borderColor: borderColor,
              ...style,
            }}
            onClick={
              interactive ? () => onCellClick?.(rowIdx, colIdx) : undefined
            }
          />
        );
      })}
    </div>
  );
};
