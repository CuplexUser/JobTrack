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
  Row,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { ClockCircleOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { RELATIONSHIP_LABELS, STATUS_LABELS } from '@jobtrack/shared';
import { useDashboard } from '../api/hooks.js';
import { StatusTag } from '../components/StatusTag.js';
import { PreApplyCheck } from '../components/PreApplyCheck.js';
import { ApplicationDrawer } from '../components/ApplicationDrawer.js';
import { BarSeries } from '../components/charts/BarSeries.js';
import { Funnel } from '../components/charts/Funnel.js';
import { DashboardHero } from '../components/DashboardHero.js';

/**
 * Cards side by side share a height. Without this, the shorter card of a pair ends early
 * and leaves a hole above the next row.
 */
const STRETCH = { display: 'flex' } as const;
const FILL = { flex: 1, minWidth: 0 } as const;

export function DashboardPage() {
  const { data, isLoading } = useDashboard();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [attention, setAttention] = useState<'follow-ups' | 'quiet' | 'reconnect'>('follow-ups');

  if (isLoading || !data) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  const { stats, followUps, recentActivity, funnel, volume, stale, reconnect } = data;

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

  const attentionCount = { 'follow-ups': followUps.length, quiet: stale.length, reconnect: reconnect.length }[attention];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <DashboardHero data={data} onNewApplication={() => setDrawerOpen(true)} />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14} style={STRETCH}>
          <PreApplyCheck onStartApplication={() => setDrawerOpen(true)} style={FILL} />
        </Col>

        <Col xs={24} lg={10} style={STRETCH}>
          <Card
            style={FILL}
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
                onChange={(value) => setAttention(value as 'follow-ups' | 'quiet' | 'reconnect')}
                options={[
                  { label: `Follow-ups (${followUps.length})`, value: 'follow-ups' },
                  { label: `Gone quiet (${stale.length})`, value: 'quiet' },
                  { label: `Reconnect (${reconnect.length})`, value: 'reconnect' },
                ]}
              />
            }
            styles={{ body: { maxHeight: 300, overflowY: 'auto' } }}
          >
            {attentionCount === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  attention === 'follow-ups'
                    ? 'Nothing due. All caught up.'
                    : attention === 'quiet'
                      ? 'Nothing has gone quiet'
                      : 'Nobody is due a reconnect'
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
            ) : attention === 'reconnect' ? (
              <List
                size="small"
                dataSource={reconnect}
                renderItem={(person) => (
                  <List.Item>
                    <List.Item.Meta
                      title={<Link to={`/people/${person.id}`}>{person.name}</Link>}
                      description={
                        <Flex justify="space-between" wrap gap={8}>
                          <span>{[person.headline, person.companyName].filter(Boolean).join(' at ')}</span>
                          <Typography.Text type="danger">due {person.reconnectOn}</Typography.Text>
                        </Flex>
                      }
                    />
                    <Tag>{RELATIONSHIP_LABELS[person.relationship]}</Tag>
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
        <Col xs={24} lg={12} style={STRETCH}>
          <Card title="Pipeline" size="small" style={FILL}>
            <Funnel stages={funnel} />
          </Card>
        </Col>

        <Col xs={24} lg={12} style={STRETCH}>
          <Card title="Applications over time" size="small" style={FILL} extra={<Link to="/statistics">More statistics</Link>}>
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
