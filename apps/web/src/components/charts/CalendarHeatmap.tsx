/**
 * Applications per day as a calendar: one column per week, Monday at the top.
 *
 * The shape a job search actually has (bursts on a Sunday evening, a quiet week of
 * interviews) is easier to see on a calendar than on a bar chart, and a day is easier to
 * pick from one. Shades are one hue from faint to full, so more is always darker, and the
 * exact count is in each cell's label and the readout above.
 */

import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { Flex, Typography } from 'antd';
import { monthName } from '@jobtrack/shared';
import { palette } from '../../theme.js';

export interface CalendarDay {
  date: string;
  count: number;
}

export interface CalendarHeatmapProps {
  /** Oldest first, starting on a Monday. */
  days: CalendarDay[];
  onSelect?: (date: string) => void;
}

const CELL = 12;
const GAP = 2;
const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/** Four steps of the series hue over the card surface, then an empty cell for zero. */
const SHADES = [30, 55, 80, 100].map((percent) => `color-mix(in oklab, ${palette.series1} ${percent}%, ${palette.bgRaised})`);

/** Which of the four shades a count takes, scaled to the busiest day on show. */
export function shadeLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return -1;
  return Math.min(SHADES.length, Math.ceil((count / max) * SHADES.length)) - 1;
}

function readable(date: string): string {
  return `${monthName(Number(date.slice(5, 7))).slice(0, 3)} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}

function describe(day: CalendarDay): string {
  return `${readable(day.date)}: ${day.count} application${day.count === 1 ? '' : 's'}`;
}

export function CalendarHeatmap({ days, onSelect }: CalendarHeatmapProps) {
  const [hovered, setHovered] = useState<CalendarDay | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Open on the most recent weeks: when the calendar is wider than its card, the end of it
  // is the part worth seeing first.
  const lastDate = days.at(-1)?.date;
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [lastDate]);

  if (days.length === 0) return null;

  const max = Math.max(...days.map((day) => day.count), 0);
  const weeks = Math.ceil(days.length / 7);
  const busiest = days.reduce((best, day) => (day.count >= best.count && day.count > 0 ? day : best), days[0]!);

  // A month's name sits over the first week column that starts in it.
  const monthLabels: { column: number; label: string }[] = [];
  for (let column = 0; column < weeks; column += 1) {
    const first = days[column * 7]!;
    const previous = column > 0 ? days[(column - 1) * 7]! : null;
    if (!previous || previous.date.slice(5, 7) !== first.date.slice(5, 7)) {
      monthLabels.push({ column, label: monthName(Number(first.date.slice(5, 7))).slice(0, 3) });
    }
  }

  const cellColor = (count: number) => {
    const level = shadeLevel(count, max);
    return level === -1 ? palette.bgSunken : SHADES[level]!;
  };

  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }} aria-live="polite">
        {hovered ? describe(hovered) : max === 0 ? 'No applications on these days' : `Busiest day: ${describe(busiest)}`}
      </Typography.Text>

      <div ref={scroller} style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'inline-grid', gridTemplateColumns: `auto repeat(${weeks}, ${CELL}px)`, gridAutoRows: CELL, columnGap: GAP, rowGap: GAP }}>
          <span />
          {Array.from({ length: weeks }, (_, column) => {
            const label = monthLabels.find((entry) => entry.column === column);
            return (
              <Typography.Text key={column} type="secondary" style={{ fontSize: 10, lineHeight: `${CELL}px`, whiteSpace: 'nowrap', width: CELL, overflow: 'visible' }}>
                {label?.label ?? ''}
              </Typography.Text>
            );
          })}

          {WEEKDAY_LABELS.map((weekday, row) => (
            <Fragment key={row}>
              <Typography.Text type="secondary" style={{ fontSize: 10, lineHeight: `${CELL}px`, paddingInlineEnd: 4, whiteSpace: 'nowrap' }}>
                {weekday}
              </Typography.Text>
              {Array.from({ length: weeks }, (_, column) => {
                const day = days[column * 7 + row];
                if (!day) return <span key={column} />;
                return (
                  <button
                    key={day.date}
                    type="button"
                    aria-label={describe(day)}
                    onMouseEnter={() => setHovered(day)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(day)}
                    onBlur={() => setHovered(null)}
                    onClick={() => onSelect?.(day.date)}
                    style={{
                      width: CELL,
                      height: CELL,
                      padding: 0,
                      border: 'none',
                      borderRadius: 3,
                      background: cellColor(day.count),
                      outline: hovered?.date === day.date ? `2px solid ${palette.textMuted}` : undefined,
                      outlineOffset: 1,
                      cursor: onSelect ? 'pointer' : 'default',
                    }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <Flex align="center" gap={4} justify="flex-end" style={{ marginTop: 6 }}>
        <Typography.Text type="secondary" style={{ fontSize: 11, marginInlineEnd: 2 }}>
          Less
        </Typography.Text>
        {[palette.bgSunken, ...SHADES].map((color) => (
          <span key={color} style={{ width: CELL - 2, height: CELL - 2, borderRadius: 3, background: color, display: 'inline-block' }} />
        ))}
        <Typography.Text type="secondary" style={{ fontSize: 11, marginInlineStart: 2 }}>
          More
        </Typography.Text>
      </Flex>
    </div>
  );
}
