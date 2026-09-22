/**
 * Applications sent and openings saved per day, week or month, as paired columns.
 *
 * Plain HTML boxes rather than an SVG stretched to fit: the columns keep their rounded tops
 * and fixed maximum width at any container size, which a `preserveAspectRatio="none"` SVG
 * cannot do. Every slot is a button, so a bucket can be picked with the keyboard as well as
 * the mouse, and the whole slot is the hit target rather than a thin column inside it.
 */

import { useState } from 'react';
import { Flex, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { palette } from '../../theme.js';

export interface TimeBucket {
  start: string;
  end: string;
  label: string;
  applications: number;
  openings: number;
}

export interface TimeBarsProps {
  points: TimeBucket[];
  height?: number;
  onSelect?: (bucket: TimeBucket) => void;
}

function describe(point: TimeBucket, t: TFunction<'charts'>): string {
  return `${point.label}: ${t('timeBars.applicationsCount', { count: point.applications })}, ${t('timeBars.openingsSavedCount', { count: point.openings })}`;
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <Flex align="center" gap={6}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
    </Flex>
  );
}

export function TimeBars({ points, height = 180, onSelect }: TimeBarsProps) {
  const { t } = useTranslation('charts');
  const [hovered, setHovered] = useState<number | null>(null);
  if (points.length === 0) return null;

  const max = Math.max(...points.flatMap((point) => [point.applications, point.openings]), 1);
  const applications = points.reduce((sum, point) => sum + point.applications, 0);
  const openings = points.reduce((sum, point) => sum + point.openings, 0);
  const active = hovered !== null ? points[hovered] : null;
  // Past a few dozen slots there is no room for a gap between the pair, or for the pair at all.
  const dense = points.length > 60;

  const bar = (value: number, color: string) => (
    <div
      style={{
        flex: 1,
        maxWidth: 24,
        height: value === 0 ? 0 : `max(${(value / max) * 100}%, 2px)`,
        background: color,
        borderRadius: dense ? '2px 2px 0 0' : '4px 4px 0 0',
      }}
    />
  );

  const edgeLabels = [points[0]!, points[Math.floor(points.length / 2)]!, points.at(-1)!];

  return (
    <div>
      <Flex justify="space-between" align="baseline" wrap gap={8} style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }} aria-live="polite">
          {active
            ? describe(active, t)
            : `${t('timeBars.applicationsCount', { count: applications })} ${t('timeBars.and')} ${t('timeBars.openingsSavedCount', { count: openings })}`}
        </Typography.Text>
        <Flex gap={12}>
          <Swatch color={palette.series1} label={t('timeBars.legendApplications')} />
          <Swatch color={palette.series2} label={t('timeBars.legendOpeningsSaved')} />
        </Flex>
      </Flex>

      <div
        role="group"
        aria-label={t('timeBars.groupAriaLabel', { from: points[0]!.label, to: points.at(-1)!.label, peak: max })}
        style={{ position: 'relative', height, display: 'flex', alignItems: 'stretch', borderBottom: `1px solid ${palette.border}` }}
        onMouseLeave={() => setHovered(null)}
      >
        {/* The one gridline: where the tallest column reaches, with its value. */}
        <div style={{ position: 'absolute', insetInline: 0, top: 0, borderTop: `1px solid ${palette.border}`, pointerEvents: 'none' }} />
        <Typography.Text
          type="secondary"
          style={{ position: 'absolute', top: -9, right: 0, fontSize: 11, background: palette.bgRaised, paddingInlineStart: 4, pointerEvents: 'none' }}
        >
          {max}
        </Typography.Text>

        {points.map((point, index) => (
          <button
            key={point.start}
            type="button"
            aria-label={describe(point, t)}
            onMouseEnter={() => setHovered(index)}
            onFocus={() => setHovered(index)}
            onBlur={() => setHovered(null)}
            onClick={() => onSelect?.(point)}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              gap: dense ? 0 : 2,
              padding: dense ? '0 0.5px' : '0 2px',
              border: 'none',
              background: hovered === index ? palette.bgSunken : 'transparent',
              cursor: onSelect ? 'pointer' : 'default',
              opacity: hovered === null || hovered === index ? 1 : 0.55,
            }}
          >
            {bar(point.applications, palette.series1)}
            {bar(point.openings, palette.series2)}
          </button>
        ))}
      </div>

      <Flex justify="space-between" style={{ marginTop: 6 }}>
        {edgeLabels.map((point, index) => (
          <Typography.Text key={index} type="secondary" style={{ fontSize: 11 }}>
            {point.label}
          </Typography.Text>
        ))}
      </Flex>
    </div>
  );
}
