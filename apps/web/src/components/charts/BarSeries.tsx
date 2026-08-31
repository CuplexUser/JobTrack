/**
 * Applications per month, as a bar chart.
 *
 * Inline SVG rather than a charting library: this is one chart with one series, and a
 * dependency in the bundle the tray ships would cost more than it saves. It also means the
 * bars take their colors from the app's own palette variables and follow the light/dark
 * theme without knowing that either exists.
 *
 * A month with no applications is drawn as an empty slot rather than skipped, because the
 * gaps in a job search are exactly as informative as the bursts.
 */

import { useState } from 'react';
import { Flex, Typography } from 'antd';
import { monthName } from '@jobtrack/shared';
import { palette } from '../../theme.js';

export interface BarPoint {
  year: number;
  month: number;
  count: number;
}

export interface BarSeriesProps {
  points: BarPoint[];
  height?: number;
}

/** "Mar 2026", the label under a bar and in its tooltip. */
function label(point: BarPoint): string {
  return `${monthName(point.month).slice(0, 3)} ${point.year}`;
}

export function BarSeries({ points, height = 140 }: BarSeriesProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) return null;

  const max = Math.max(...points.map((point) => point.count), 1);
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const active = hovered !== null ? points[hovered] : null;

  // One unit of width per bar, so the viewBox scales to any container width.
  const step = 10;
  const barWidth = 7;
  const viewHeight = 100;

  return (
    <div>
      <Flex justify="space-between" align="baseline" style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {active
            ? `${label(active)}: ${active.count} application${active.count === 1 ? '' : 's'}`
            : `${total} application${total === 1 ? '' : 's'} over ${points.length} months`}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          peak {max}
        </Typography.Text>
      </Flex>

      <svg
        viewBox={`0 0 ${points.length * step} ${viewHeight}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Applications per month, ${label(points[0]!)} to ${label(points.at(-1)!)}. Peak ${max} in one month, ${total} in total.`}
        style={{ display: 'block', width: '100%', height }}
        onMouseLeave={() => setHovered(null)}
      >
        <title>Applications per month</title>
        {points.map((point, index) => {
          const barHeight = point.count === 0 ? 0 : Math.max((point.count / max) * viewHeight, 2);
          return (
            <g key={`${point.year}-${point.month}`} onMouseEnter={() => setHovered(index)}>
              {/* A full-height transparent target, so hovering the gap above a short bar
                  still reads that month rather than nothing. */}
              <rect x={index * step} y="0" width={step} height={viewHeight} fill="transparent" />
              <rect
                x={index * step + (step - barWidth) / 2}
                y={viewHeight - barHeight}
                width={barWidth}
                height={Math.max(barHeight, 1)}
                rx="1"
                fill={point.count === 0 ? palette.border : palette.accent}
                opacity={hovered === null || hovered === index ? 1 : 0.45}
              />
            </g>
          );
        })}
      </svg>

      {/* Only the ends and the middle are labeled: 24 labels under 24 bars is unreadable. */}
      <Flex justify="space-between" style={{ marginTop: 6 }}>
        {[points[0]!, points[Math.floor(points.length / 2)]!, points.at(-1)!].map((point, index) => (
          <Typography.Text key={index} type="secondary" style={{ fontSize: 11 }}>
            {label(point)}
          </Typography.Text>
        ))}
      </Flex>
    </div>
  );
}
