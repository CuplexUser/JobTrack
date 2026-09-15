/**
 * The job search as a landscape: the front ridge is applications per month, the ranges
 * behind it are the same history smoothed and pushed back toward the horizon.
 *
 * Decoration with a source: the shape is the user's own two years, so a busy spring reads
 * as a mountain and a quiet summer as a valley. The exact figures live in the bar chart
 * further down the dashboard, which is why the drawing itself is hidden from screen readers
 * and only the peak's label is text.
 *
 * The SVG stretches to any width (`preserveAspectRatio="none"`), so everything that must
 * keep its shape (the peak flag and the dot for this month) is HTML laid over it
 * at percentage positions.
 */

import { monthName } from '@jobtrack/shared';
import { palette } from '../../theme.js';

export interface TerrainPoint {
  year: number;
  month: number;
  count: number;
}

const WIDTH = 1200;
const HEIGHT = 200;
/** Keep the first and last month off the very edges, so their markers are not cut. */
const INSET = 0.03;

/** Moving average over `radius` months either side, for the ranges further back. */
function smooth(values: number[], radius: number): number[] {
  return values.map((_, index) => {
    const window = values.slice(Math.max(0, index - radius), index + radius + 1);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
}

/** A Catmull-Rom curve through the points, as cubic Bézier segments following a move to the first. */
function curve(points: [number, number][]): string {
  let path = '';
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return path;
}

/** A ridge as a filled shape: level out to both edges, then down to the ground. */
function ridgePath(points: [number, number][]): string {
  const [x0, y0] = points[0]!;
  const yLast = points.at(-1)![1];
  return `M0,${HEIGHT} L0,${y0.toFixed(1)} L${x0.toFixed(1)},${y0.toFixed(1)}${curve(points)} L${WIDTH},${yLast.toFixed(1)} L${WIDTH},${HEIGHT} Z`;
}

/** The open top edge of a ridge, for the line drawn along the nearest one. */
function ridgeLine(points: [number, number][]): string {
  const [x0, y0] = points[0]!;
  return `M${x0.toFixed(1)},${y0.toFixed(1)}${curve(points)}`;
}

/** Stars at fixed places, so the sky does not rearrange itself on every render. */
const STARS: { left: number; top: number; size: number }[] = [
  [6, 18, 2], [13, 42, 1], [21, 12, 1], [29, 30, 2], [37, 8, 1], [44, 36, 1], [52, 16, 2],
  [58, 44, 1], [66, 10, 1], [71, 28, 2], [79, 14, 1], [86, 38, 1], [92, 20, 2], [97, 6, 1],
].map(([left, top, size]) => ({ left: left!, top: top!, size: size! }));

/** A few stars over the landscape. Shown only in the dark theme, where there is a night sky. */
export function Stars() {
  return (
    <div className="jt-terrain-stars" aria-hidden="true">
      {STARS.map((star, index) => (
        <span key={index} style={{ left: `${star.left}%`, top: `${star.top}%`, width: star.size, height: star.size }} />
      ))}
    </div>
  );
}

export interface TerrainProps {
  points: TerrainPoint[];
  height?: number;
}

export function Terrain({ points, height = 170 }: TerrainProps) {
  if (points.length < 2) return null;

  const counts = points.map((point) => point.count);
  const max = Math.max(...counts, 1);
  const x = (index: number) => (INSET + (index / (points.length - 1)) * (1 - 2 * INSET)) * WIDTH;
  // Even an empty month is a valley above the ground, never a flat line along the bottom.
  const near = counts.map((count, i) => [x(i), HEIGHT - (26 + (count / max) * 110)] as [number, number]);
  // The ranges behind follow the history loosely and add fixed folds of their own, so a
  // steady search still looks like mountains rather than a plateau.
  const middle = smooth(counts, 2).map(
    (value, i) => [x(i), HEIGHT - (62 + (value / max) * 70 + 22 * Math.sin(i * 1.1 + 0.4) + 8 * Math.sin(i * 2.9))] as [number, number],
  );
  const far = smooth(counts, 4).map(
    (value, i) => [x(i), HEIGHT - (108 + (value / max) * 40 + 30 * Math.sin(i * 0.55 + 1.2) + 10 * Math.sin(i * 1.9))] as [number, number],
  );

  // `max` is floored at 1 for scaling, so an empty history has no index for it: no peak.
  const peakIndex = counts.lastIndexOf(Math.max(...counts));
  const peak = points[peakIndex]!;
  const hasPeak = peak.count > 0;
  const percentX = (index: number) => (x(index) / WIDTH) * 100;
  const percentUp = (y: number) => ((HEIGHT - y) / HEIGHT) * 100;

  const tint = (percent: number) => `color-mix(in oklab, ${palette.accent} ${percent}%, ${palette.bgRaised})`;

  return (
    <div className="jt-terrain" style={{ position: 'relative', height }} aria-hidden="true">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
      >
        <path className="jt-ridge jt-ridge-far" d={ridgePath(far)} fill={tint(16)} />
        <path className="jt-ridge jt-ridge-middle" d={ridgePath(middle)} fill={tint(30)} />
        <g className="jt-ridge jt-ridge-near">
          <path d={ridgePath(near)} fill={tint(50)} />
          <path
            d={ridgeLine(near)}
            fill="none"
            stroke={palette.accent}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>

      {hasPeak && (
        <div
          className={`jt-terrain-flag${percentX(peakIndex) > 70 ? ' jt-flag-left' : ''}`}
          style={{ left: `${percentX(peakIndex)}%`, bottom: `${percentUp(near[peakIndex]![1])}%` }}
        >
          <svg width="14" height="22" viewBox="0 0 14 22">
            <line x1="1" y1="1" x2="1" y2="22" stroke={palette.textPrimary} strokeWidth="1.5" />
            <path d="M1.5 1.5 L13 5.5 L1.5 9.5 Z" fill={palette.series2} />
          </svg>
          <span>
            Peak: {peak.count} in {monthName(peak.month).slice(0, 3)} {peak.year}
          </span>
        </div>
      )}

      <span
        className="jt-terrain-now"
        style={{ left: `${percentX(points.length - 1)}%`, bottom: `${percentUp(near.at(-1)![1])}%` }}
      />
    </div>
  );
}
