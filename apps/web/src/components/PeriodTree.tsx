/**
 * The year/month navigation.
 *
 * Counts come from a dedicated endpoint rather than the current page, so they keep showing
 * the whole picture while the table is filtered down to one month.
 */

import { useMemo } from 'react';
import { Empty, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { monthName } from '@jobtrack/shared';
import type { PeriodNode } from '../api/client.js';

export interface PeriodTreeProps {
  periods: PeriodNode[];
  year: number | undefined;
  month: number | undefined;
  onSelect: (selection: { year?: number; month?: number }) => void;
}

export function PeriodTree({ periods, year, month, onSelect }: PeriodTreeProps) {
  const treeData = useMemo<DataNode[]>(
    () =>
      periods.map((node) => ({
        key: `y:${node.year}`,
        title: <NodeLabel label={String(node.year)} count={node.count} strong />,
        children: (node.months ?? []).map((child) => ({
          key: `m:${child.year}:${child.month}`,
          title: <NodeLabel label={monthName(child.month)} count={child.count} />,
        })),
      })),
    [periods],
  );

  const selectedKeys = useMemo(() => {
    if (year && month) return [`m:${year}:${month}`];
    if (year) return [`y:${year}`];
    return [];
  }, [year, month]);

  // Open the selected year, and the most recent one by default.
  const defaultExpanded = useMemo(() => {
    const first = periods[0];
    const keys = first ? [`y:${first.year}`] : [];
    if (year && !keys.includes(`y:${year}`)) keys.push(`y:${year}`);
    return keys;
  }, [periods, year]);

  if (periods.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No applications yet" />;
  }

  return (
    <Tree
      treeData={treeData}
      selectedKeys={selectedKeys}
      defaultExpandedKeys={defaultExpanded}
      blockNode
      onSelect={(keys) => {
        const key = String(keys[0] ?? '');
        if (key.startsWith('m:')) {
          const [, y, m] = key.split(':');
          onSelect({ year: Number(y), month: Number(m) });
        } else if (key.startsWith('y:')) {
          onSelect({ year: Number(key.slice(2)) });
        } else {
          onSelect({}); // clicking the selected node again clears the filter
        }
      }}
    />
  );
}

function NodeLabel({ label, count, strong }: { label: string; count: number; strong?: boolean }) {
  return (
    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <Typography.Text strong={strong}>{label}</Typography.Text>
      <Typography.Text type="secondary">{count}</Typography.Text>
    </span>
  );
}
