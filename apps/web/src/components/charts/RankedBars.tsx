/**
 * A breakdown as horizontal bars, largest first: where applications went, by location,
 * source, work mode or company.
 *
 * Each row's label is a link to the applications it counts, when a filter can express them,
 * so the chart is also the way in to the list.
 */

import type { ReactNode } from 'react';
import { Flex, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { palette } from '../../theme.js';

export interface RankedRow {
  key: string;
  label: string;
  count: number;
  /** 0-1. */
  share: number;
  /** Where the label links to. None for rows no filter can reproduce. */
  href?: string | null;
  /** Drawn in place of the plain label, such as a status tag. */
  labelNode?: ReactNode;
}

export interface RankedBarsProps {
  rows: RankedRow[];
  /** What is being counted, for the accessible summary. */
  title: string;
  /** Rows that stand apart from the ranking ("Other", "Unspecified") are drawn fainter. */
  mutedKeys?: readonly string[];
}

export function RankedBars({ rows, title, mutedKeys = ['__other', '__unspecified'] }: RankedBarsProps) {
  const { t } = useTranslation('charts');
  const max = Math.max(...rows.map((row) => row.count), 1);

  return (
    <ul
      aria-label={`${title}: ${rows.map((row) => `${row.label} ${row.count}`).join(', ')}`}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {rows.map((row) => {
        const muted = mutedKeys.includes(row.key);
        return (
          <li key={row.key}>
            <Flex justify="space-between" align="baseline" gap={8}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.labelNode ??
                  (row.href ? (
                    <Link to={row.href} title={t('rankedBars.showInApplications', { count: row.count })}>
                      {row.label}
                    </Link>
                  ) : (
                    <Typography.Text type={muted ? 'secondary' : undefined}>{row.label}</Typography.Text>
                  ))}
              </span>
              <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {row.count} · {Math.round(row.share * 100)}%
              </Typography.Text>
            </Flex>
            <div style={{ height: 8, marginTop: 4, borderRadius: 4, background: palette.bgSunken }}>
              <div
                style={{
                  width: `max(${(row.count / max) * 100}%, 4px)`,
                  height: '100%',
                  borderRadius: 4,
                  background: muted ? palette.borderStrong : palette.series1,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
