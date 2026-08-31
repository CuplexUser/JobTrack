/**
 * Dashboard: where the search stands, what needs chasing, and what happened recently.
 *
 * Two things drive the layout. *Check before you apply* is the app's reason for existing, so
 * it sits at the top rather than halfway down. And everything that wants a decision — a
 * follow-up that has come due, an application that has gone silent — is collected into one
 * card, because a list you have to go looking for is a list you stop reading.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Empty,
  Flex,
  List,
  Progress,
  Row,
  Segmented,
  Skeleton,
  Space,
  Statistic,
  Timeline,
  Typography,
} from 'antd';
import { ClockCircleOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { STATUS_LABELS, monthName, toPeriod, todayDateOnly } from '@jobtrack/shared';
import { useDashboard } from '../api/hooks.js';
import { StatusTag } from '../components/StatusTag.js';
import { PreApplyCheck } from '../components/PreApplyCheck.js';
import { ApplicationDrawer } from '../components/ApplicationDrawer.js';
import { BarSeries } from '../components/charts/BarSeries.js';
import { Funnel } from '../components/charts/Funnel.js';
import { Sparkline } from '../components/charts/Sparkline.js';
import { palette } from '../theme.js';

/** How many months of history the stat tile's sparkline shows. */
const TREND_MONTHS = 12;

export function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [attention, setAttention] = useState<'follow-ups' | 'quiet'>('follow-ups');
  const period = toPeriod(todayDateOnly());

  if (isLoading || !data) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  const { stats, followUps, recentActivity, funnel, volume, stale } = data;

  if (stats.total === 0) {
    return (
      <>
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={4}>
                <Typography.Text strong>No applications yet</Typography.Text>
                <Typography.Text type="secondary">
                  Add the first one, or bring in a spreadsheet you already keep.
                </Typography.Text>
              </Space>
            }
          >
            <Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
                New application
              </Button>
              <Link to="/applications">
                <Button icon={<UploadOutlined />}>Import</Button>
              </Link>
            </Space>
          </Empty>
        </Card>
        <ApplicationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </>
    );
  }

  // The trend behind "this month": the same months the volume chart shows, tail end only.
  const trend = volume.slice(-TREND_MONTHS);
  const previousMonths = volume.slice(-13, -1);
  const monthlyAverage =
    previousMonths.length > 0
      ? previousMonths.reduce((sum, point) => sum + point.count, 0) / previousMonths.length
      : 0;
  const againstAverage = stats.thisMonth - monthlyAverage;

  const attentionCount = attention === 'follow-ups' ? followUps.length : stale.length;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={12} md={6}>
          <Card size="small">
            <Statistic title="Total applications" value={stats.total} />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small">
            <Statistic
              title="Still active"
              value={stats.active}
              valueStyle={{ color: palette.accent }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small">
            <Statistic title={`${monthName(period.month)} ${period.year}`} value={stats.thisMonth} />
            <Sparkline
              values={trend.map((point) => point.count)}
              label={`Applications in each of the last ${trend.length} months: ${trend
                .map((point) => point.count)
                .join(', ')}`}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {monthlyAverage === 0
                ? 'first month on record'
                : `${againstAverage >= 0 ? '+' : ''}${againstAverage.toFixed(1)} vs your monthly average`}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card size="small">
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Typography.Text type="secondary">Response rate</Typography.Text>
              <Progress
                percent={Math.round(stats.responseRate * 100)}
                size="small"
                strokeColor={palette.accent}
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
                <span>Needs attention</span>
              </Space>
            }
            extra={
              <Segmented
                size="small"
                value={attention}
                onChange={(value) => setAttention(value as 'follow-ups' | 'quiet')}
                options={[
                  { label: `Follow-ups (${followUps.length})`, value: 'follow-ups' },
                  { label: `Gone quiet (${stale.length})`, value: 'quiet' },
                ]}
              />
            }
            styles={{ body: { maxHeight: 320, overflowY: 'auto' } }}
          >
            {attentionCount === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  attention === 'follow-ups'
                    ? 'Nothing due — all caught up'
                    : 'Nothing has gone quiet'
                }
              />
            ) : attention === 'follow-ups' ? (
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
            ) : (
              <List
                size="small"
                dataSource={stale}
                // The counterpart to the follow-up list: these have no date set, which is
                // exactly why nothing has reminded you about them.
                header={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Still live, no follow-up date, and nothing has moved.
                  </Typography.Text>
                }
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<Link to={`/applications/${item.id}`}>{item.jobTitle}</Link>}
                      description={
                        <Flex justify="space-between" wrap gap={8}>
                          <span>{item.company.name}</span>
                          <Typography.Text type="warning">
                            silent {item.silentDays} days
                          </Typography.Text>
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
          <Card title="Pipeline" size="small">
            <Funnel stages={funnel} />
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Applications over time" size="small">
            <BarSeries points={volume} />
          </Card>
        </Col>
      </Row>

      <Card title="Recent activity" size="small" styles={{ body: { maxHeight: 360, overflowY: 'auto' } }}>
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

      <ApplicationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </Space>
  );
}
