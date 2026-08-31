/**
 * A line small enough to sit inside a stat tile.
 *
 * No axes, no labels, no interaction: a sparkline's whole job is to give a number a shape —
 * "12 this month" means something different when the last six months were 2, 3, 4, 6, 9, 12
 * than when they were 40, 30, 20, 15, 13, 12. The number stays the headline; this is the
 * sentence after it.
 */

import { palette } from '../../theme.js';

export interface SparklineProps {
  values: number[];
  /** Described to a screen reader, which cannot see the shape. */
  label: string;
  height?: number;
}

export function Sparkline({ values, label, height = 28 }: SparklineProps) {
  if (values.length < 2) return null;

  const max = Math.max(...values, 1);
  const width = 100;
  const step = width / (values.length - 1);

  // y is inverted: SVG counts down from the top, the data counts up from zero.
  const point = (value: number, index: number): string =>
    `${(index * step).toFixed(2)},${(100 - (value / max) * 100).toFixed(2)}`;

  const line = values.map(point).join(' ');
  const area = `0,100 ${line} ${width},100`;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      style={{ display: 'block', width: '100%', height }}
    >
      <title>{label}</title>
      <polygon points={area} fill={palette.accent} opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke={palette.accent}
        strokeWidth="2"
        // The viewBox is stretched by preserveAspectRatio="none", which would otherwise
        // shear the joins; rounding them keeps the line even at any container width.
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
