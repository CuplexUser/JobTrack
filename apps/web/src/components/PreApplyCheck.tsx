/**
 * "Check before you apply."
 *
 * The same duplicate logic as the form, but reachable without starting one — you have a
 * job ad open in another tab, you type the company and title here, and you get an answer
 * before committing to anything.
 */

import { useState } from 'react';
import { Button, Card, Col, Input, Row, Space, Typography } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useDuplicateCheck } from '../api/hooks.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { DuplicateAlert } from './DuplicateAlert.js';

export function PreApplyCheck({ onStartApplication }: { onStartApplication?: () => void }) {
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
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
          <Typography.Text type="secondary">
            Type a company name to see whether you have been here before.
          </Typography.Text>
        )}
      </Space>
    </Card>
  );
}
