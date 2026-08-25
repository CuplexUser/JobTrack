/**
 * Dashboard: where the search stands, what needs chasing, and what happened recently.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  Col,
  Empty,
  Flex,
  List,
  Progress,
  Row,
  Skeleton,
  Space,
  Statistic,
  Timeline,
  Typography,
} from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { STATUS_LABELS, monthName, toPeriod, todayDateOnly } from '@jobtrack/shared';
import { useDashboard } from '../api/hooks.js';
import { StatusTag } from '../components/StatusTag.js';
import { PreApplyCheck } from '../components/PreApplyCheck.js';
import { ApplicationDrawer } from '../components/ApplicationDrawer.js';

export function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const period = toPeriod(todayDateOnly());

  if (isLoading || !data) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  const { stats, followUps, recentActivity } = data;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={12} md={6}>
          <Card>
            <Statistic title="Total applications" value={stats.total} />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card>
            <Statistic title="Still active" value={stats.active} valueStyle={{ color: '#4f46e5' }} />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card>
            <Statistic
              title={`${monthName(period.month)} ${period.year}`}
              value={stats.thisMonth}
              suffix={stats.thisMonth === 1 ? 'application' : 'applications'}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Typography.Text type="secondary">Response rate</Typography.Text>
              <Progress
                percent={Math.round(stats.responseRate * 100)}
                size="small"
                strokeColor="#4f46e5"
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Anything past “applied” counts as a reply
              </Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <PreApplyCheck onStartApplication={() => setDrawerOpen(true)} />
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title={
              <Space>
                <ClockCircleOutlined />
                <span>Needs a follow-up</span>
              </Space>
            }
            styles={{ body: { maxHeight: 320, overflowY: 'auto' } }}
          >
            {followUps.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing due — all caught up" />
            ) : (
              <List
                size="small"
                dataSource={followUps}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<Link to={`/applications/${item.id}`}>{item.jobTitle}</Link>}
                      description={
                        <Flex justify="space-between" wrap gap={8}>
                          <span>{item.company.name}</span>
                          <Typography.Text type="danger">due {item.followUpOn}</Typography.Text>
                        </Flex>
                      }
                    />
                    <StatusTag status={item.status} />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Pipeline">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {Object.entries(stats.byStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <Flex key={status} align="center" gap={12}>
                    <div style={{ width: 100 }}>
                      <StatusTag status={status as never} />
                    </div>
                    <Progress
                      percent={stats.total > 0 ? Math.round((count / stats.total) * 100) : 0}
                      format={() => count}
                      size="small"
                      style={{ flex: 1, marginBottom: 0 }}
                    />
                  </Flex>
                ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Recent activity" styles={{ body: { maxHeight: 360, overflowY: 'auto' } }}>
            {recentActivity.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No status changes yet" />
            ) : (
              <Timeline
                items={recentActivity.map((event) => ({
                  color:
                    event.toStatus === 'offer'
                      ? 'green'
                      : event.toStatus === 'rejected'
                        ? 'red'
                        : 'blue',
                  children: (
                    <Space direction="vertical" size={0}>
                      <Typography.Text>
                        <Link to={`/applications/${event.applicationId}`}>{event.jobTitle}</Link>
                        {' at '}
                        {event.companyName}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {event.fromStatus
                          ? `${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}`
                          : `Applied (${STATUS_LABELS[event.toStatus]})`}{' '}
                        · {event.occurredOn}
                      </Typography.Text>
                    </Space>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>

      <ApplicationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </Space>
  );
}
