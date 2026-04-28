import { useMemo } from "react";

interface RatingPoint {
  /** ISO date for x-axis label / sort */
  recordedAt: string;
  rating: number;
  rd?: number;
}

interface RatingChartProps {
  points: RatingPoint[];
  /** Initial rating shown as a flat baseline before any points (default 1500). */
  baseline?: number;
  className?: string;
}

/**
 * Hand-rolled SVG line chart for rating progression. Draws a polyline through
 * the points with a baseline grid line at 1500. Hover dots show the value.
 *
 * Mobile-friendly: viewBox responsive, no external chart library.
 */
export function RatingChart({
  points,
  baseline = 1500,
  className,
}: RatingChartProps) {
  const sorted = useMemo(
    () =>
      [...points].sort(
        (a, b) =>
          new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
      ),
    [points]
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
        Not enough rating history yet — finalize at least one event with this player.
      </div>
    );
  }

  // Include baseline in y-range computation so it's always visible
  const allValues = [baseline, ...sorted.map((p) => p.rating)];
  const minY = Math.min(...allValues) - 50;
  const maxY = Math.max(...allValues) + 50;

  // Chart dimensions in viewBox space
  const W = 600;
  const H = 200;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // x: distribute points evenly. y: scaled to value range.
  const xFor = (i: number) =>
    sorted.length === 1
      ? PAD_L + innerW / 2
      : PAD_L + (innerW * i) / (sorted.length - 1);
  const yFor = (v: number) => {
    const t = (v - minY) / (maxY - minY);
    return PAD_T + innerH * (1 - t);
  };

  const polyline = sorted
    .map((p, i) => `${xFor(i)},${yFor(p.rating)}`)
    .join(" ");
  const baselineY = yFor(baseline);

  // Y-axis grid lines at 100-unit intervals
  const gridSpacing = 100;
  const gridStart = Math.ceil(minY / gridSpacing) * gridSpacing;
  const gridLines: number[] = [];
  for (let v = gridStart; v <= maxY; v += gridSpacing) {
    gridLines.push(v);
  }

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Rating history chart"
      >
        {/* Y-axis grid lines */}
        {gridLines.map((v) => (
          <g key={v}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="hsl(var(--border))"
              strokeWidth="1"
              strokeDasharray={v === baseline ? "" : "2 4"}
            />
            <text
              x={PAD_L - 6}
              y={yFor(v) + 4}
              textAnchor="end"
              className="fill-muted-foreground"
              fontSize="11"
            >
              {v}
            </text>
          </g>
        ))}

        {/* Baseline label */}
        <text
          x={W - PAD_R}
          y={baselineY - 4}
          textAnchor="end"
          className="fill-muted-foreground"
          fontSize="10"
        >
          starting ({baseline})
        </text>

        {/* Trend line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Points */}
        {sorted.map((p, i) => (
          <g key={i}>
            <circle
              cx={xFor(i)}
              cy={yFor(p.rating)}
              r="4"
              fill="hsl(var(--card))"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
            />
            {/* Tooltip on hover via title element */}
            <title>{`${new Date(
              p.recordedAt
            ).toLocaleDateString()}: ${Math.round(p.rating)}`}</title>
          </g>
        ))}

        {/* X-axis labels: first and last point dates */}
        {sorted.length > 0 && (
          <>
            <text
              x={xFor(0)}
              y={H - 6}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize="10"
            >
              {new Date(sorted[0].recordedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </text>
            {sorted.length > 1 && (
              <text
                x={xFor(sorted.length - 1)}
                y={H - 6}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="10"
              >
                {new Date(
                  sorted[sorted.length - 1].recordedAt
                ).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
