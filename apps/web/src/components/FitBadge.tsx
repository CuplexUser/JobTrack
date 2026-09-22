/**
 * An opening's fit against the profile: the score at a glance, and the reasons behind it on
 * hover, so a surprising rank can be understood rather than taken on faith.
 */

import { Space, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { FitResult } from '@jobtrack/shared';

function colorFor(score: number): string {
  if (score >= 70) return 'green';
  if (score >= 45) return 'gold';
  return 'default';
}

export function FitBadge({ fit }: { fit: FitResult | null }) {
  const { t } = useTranslation('fit');
  if (!fit) return null;

  const details = (
    <Space direction="vertical" size={2}>
      {fit.reasons.map((reason) => (
        <Space key={`${reason.factor}-${reason.label}`} size={6} align="start">
          {reason.effect === 'plus' ? (
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
          ) : reason.effect === 'minus' ? (
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
          ) : (
            <MinusCircleOutlined />
          )}
          <span>{t(reason.i18nKey, reason.i18nParams)}</span>
        </Space>
      ))}
      {!fit.semanticUsed && (
        <Typography.Text style={{ color: 'inherit', opacity: 0.75, fontSize: 12 }}>
          {t('semanticPending')}
        </Typography.Text>
      )}
    </Space>
  );

  return (
    <Tooltip title={details}>
      <Tag color={colorFor(fit.score)} style={{ marginInlineEnd: 0, minWidth: 44, textAlign: 'center' }}>
        {fit.score}
      </Tag>
    </Tooltip>
  );
}
