/**
 * The pipeline as a funnel, drawn as plain SVG.
 *
 * Bars rather than a tapering trapezoid: a trapezoid encodes the same number twice (width
 * and area) and reads as a smooth flow even when the drop between two stages is a cliff.
 * A bar per stage, each labeled with its count and the share of the stage above it, says
 * the thing the chart exists to say — where people stop replying.
 */

import { Space, Typography } from 'antd';
import { STATUS_LABELS, type ApplicationStatus } from '@jobtrack/shared';
import { palette } from '../../theme.js';

export interface FunnelStage {
  status: ApplicationStatus;
  count: number;
  conversion: number | null;
}

export interface FunnelProps {
  stages: FunnelStage[];
}

/**
 * Ant Design's status colors are preset names (`blue`, `gold`), not CSS values, so the bars
 * use the app's own accent instead, at a strength that follows the stage. Later stages are
 * rarer and stronger, which matches how the eye reads a funnel top to bottom.
 */
const STRENGTH = [0.45, 0.6, 0.78, 1];

export function Funnel({ stages }: FunnelProps) {
  const top = stages[0]?.count ?? 0;

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {stages.map((stage, index) => {
        const share = top > 0 ? stage.count / top : 0;
        return (
          <div key={stage.status}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 4,
                gap: 8,
              }}
            >
              <Typography.Text style={{ fontSize: 13 }}>
                {STATUS_LABELS[stage.status]}
              </Typography.Text>
              <Space size={8}>
                <Typography.Text strong>{stage.count}</Typography.Text>
                {stage.conversion !== null && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {Math.round(stage.conversion * 100)}% of previous
                  </Typography.Text>
                )}
              </Space>
            </div>

            <svg
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${STATUS_LABELS[stage.status]}: ${stage.count} applications ever reached this stage`}
              style={{ display: 'block', width: '100%', height: 10 }}
            >
              <title>{`${STATUS_LABELS[stage.status]}: ${stage.count}`}</title>
              <rect x="0" y="0" width="100" height="6" rx="1.5" fill={palette.bgSunken} />
              {share > 0 && (
                <rect
                  x="0"
                  y="0"
                  width={Math.max(share * 100, 1)}
                  height="6"
                  rx="1.5"
                  fill={palette.accent}
                  opacity={STRENGTH[index] ?? 1}
                />
              )}
            </svg>
          </div>
        );
      })}

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Counted from your status history — an application that interviewed and was then
        turned down still counts at every stage it reached.
      </Typography.Text>
    </Space>
  );
}
