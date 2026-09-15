/**
 * "Check before you apply."
 *
 * The same duplicate logic as the form, but reachable without starting one — you have a
 * job ad open in another tab, you type the company and title here, and you get an answer
 * before committing to anything.
 */

import { useState, type CSSProperties } from 'react';
import { Button, Card, Col, Input, Row, Space, Typography } from 'antd';
import { palette } from '../theme.js';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useDuplicateCheck } from '../api/hooks.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { DuplicateAlert } from './DuplicateAlert.js';

export function PreApplyCheck({
  onStartApplication,
  style,
}: {
  onStartApplication?: () => void;
  style?: CSSProperties;
}) {
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');

  const debouncedCompany = useDebounced(company, 350);
  const debouncedTitle = useDebounced(title, 350);

  const { data, isFetching } = useDuplicateCheck({
    company: debouncedCompany,
    title: debouncedTitle,
  });

  const hasQuery = debouncedCompany.trim().length > 1;

  return (
    <Card
      style={{ display: 'flex', flexDirection: 'column', ...style }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
      title={
        <Space>
          <SafetyCertificateOutlined />
          <span>Check before you apply</span>
        </Space>
      }
      extra={
        onStartApplication && (
          <Button type="link" onClick={onStartApplication}>
            New application
          </Button>
        )
      }
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Input
              placeholder="Company"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              allowClear
            />
          </Col>
          <Col xs={24} sm={12}>
            <Input
              placeholder="Job title (optional)"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              allowClear
            />
          </Col>
        </Row>

        {hasQuery ? (
          <DuplicateAlert check={data} loading={isFetching} />
        ) : (
          <div className="jt-check-idle">
            <TrailSign />
            <Typography.Text type="secondary">
              Type a company name to see whether you have been here before.
            </Typography.Text>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * A signpost on a hill, in the dashboard landscape's colors: the question this card answers
 * is "which way have I been?". Decorative, so hidden from screen readers.
 */
function TrailSign() {
  const tint = (percent: number) => `color-mix(in oklab, ${palette.accent} ${percent}%, ${palette.bgRaised})`;
  return (
    <svg width="168" height="96" viewBox="0 0 168 96" aria-hidden="true">
      <path d="M4 96 C22 70 44 58 66 48 C88 38 106 44 126 56 C144 67 158 80 166 96 Z" fill={tint(16)} />
      <path d="M0 96 C28 80 56 72 84 72 C112 72 140 80 168 96 Z" fill={tint(34)} />
      <line x1="84" y1="72" x2="84" y2="14" stroke={palette.textMuted} strokeWidth="3" strokeLinecap="round" />
      <path d="M86 18 H118 L126 25 L118 32 H86 Z" fill={palette.accent} />
      <path d="M82 38 H52 L44 45 L52 52 H82 Z" fill={palette.series2} />
    </svg>
  );
}
