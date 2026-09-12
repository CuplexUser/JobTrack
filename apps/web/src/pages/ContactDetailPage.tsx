/**
 * One person: who they are, every conversation logged with them, and the applications and
 * openings they had a part in.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  List,
  Popconfirm,
  Row,
  Skeleton,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  LinkedinOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import {
  CHANNEL_LABELS,
  CONTACT_ROLE_LABELS,
  RELATIONSHIP_LABELS,
  todayDateOnly,
} from '@jobtrack/shared';
import {
  useContact,
  useDeleteContact,
  useDeleteInteraction,
  useSaveContact,
  useUnlinkContact,
} from '../api/hooks.js';
import { ContactDrawer } from '../components/ContactDrawer.js';
import { InteractionModal } from '../components/InteractionModal.js';

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { data, isLoading } = useContact(id);
  const remove = useDeleteContact();
  const removeInteraction = useDeleteInteraction();
  const unlink = useUnlinkContact();
  const save = useSaveContact();
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);

  if (isLoading || !data) return <Skeleton active paragraph={{ rows: 8 }} />;

  const reconnectDue = data.reconnectOn !== null && data.reconnectOn <= todayDateOnly();
  const notSet = <Typography.Text type="secondary">Not set</Typography.Text>;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="flex-start" wrap gap={12}>
        <Space direction="vertical" size={4}>
          <Button type="link" icon={<ArrowLeftOutlined />} style={{ padding: 0 }} onClick={() => navigate('/people')}>
            Back to people
          </Button>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {data.name}
          </Typography.Title>
          <Space size={8} wrap>
            {(data.headline || data.companyName) && (
              <Typography.Text>
                {[data.headline, data.companyName].filter(Boolean).join(' at ')}
              </Typography.Text>
            )}
            <Tag>{RELATIONSHIP_LABELS[data.relationship]}</Tag>
            {data.archived && <Tag color="default">Archived</Tag>}
          </Space>
        </Space>

        <Space wrap>
          <Button type="primary" icon={<MessageOutlined />} onClick={() => setLogging(true)}>
            Log a conversation
          </Button>
          <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Popconfirm
            title={`Delete ${data.name}?`}
            description="Their conversations and links go too. This cannot be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              if (!id) return;
              await remove.mutateAsync(id);
              message.success('Person deleted');
              navigate('/people');
            }}
          >
            <Button danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </Flex>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title="Details">
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Works at">{data.companyName ?? notSet}</Descriptions.Item>
                <Descriptions.Item label="Their role">{data.headline ?? notSet}</Descriptions.Item>
                <Descriptions.Item label="Email">
                  {data.email ? <a href={`mailto:${data.email}`}>{data.email}</a> : notSet}
                </Descriptions.Item>
                <Descriptions.Item label="Phone">{data.phone ?? notSet}</Descriptions.Item>
                <Descriptions.Item label="LinkedIn">
                  {data.linkedinUrl ? (
                    <a href={data.linkedinUrl} target="_blank" rel="noreferrer">
                      <Space size={4}>
                        <LinkedinOutlined />
                        Profile
                      </Space>
                    </a>
                  ) : (
                    notSet
                  )}
                </Descriptions.Item>
                {data.connectedOn && <Descriptions.Item label="Connected on">{data.connectedOn}</Descriptions.Item>}
                <Descriptions.Item label="Reconnect on">
                  {data.reconnectOn ? (
                    <Space size={8}>
                      <Typography.Text type={reconnectDue ? 'danger' : undefined}>{data.reconnectOn}</Typography.Text>
                      <Button
                        size="small"
                        type="link"
                        onClick={() => id && save.mutate({ id, body: { reconnectOn: null } })}
                      >
                        Clear
                      </Button>
                    </Space>
                  ) : (
                    notSet
                  )}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {data.about && (
              <Card title="Notes">
                <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{data.about}</Typography.Paragraph>
              </Card>
            )}

            <Card title={`Applications and openings (${data.links.length})`}>
              {data.links.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Not linked to anything. Link people from an application's page."
                />
              ) : (
                <List
                  size="small"
                  dataSource={data.links}
                  renderItem={(link) => (
                    <List.Item
                      actions={[
                        <Button key="unlink" type="text" icon={<DisconnectOutlined />} onClick={() => unlink.mutate(link.id)} />,
                      ]}
                    >
                      <Space size={8} wrap>
                        {link.targetType === 'application' ? (
                          <Link to={`/applications/${link.targetId}`}>{link.targetLabel ?? 'Deleted application'}</Link>
                        ) : (
                          <Link to="/openings">{link.targetLabel ?? 'Deleted opening'}</Link>
                        )}
                        <Tag color="blue">{CONTACT_ROLE_LABELS[link.role]}</Tag>
                        {link.targetType === 'opening' && <Tag>Opening</Tag>}
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Space>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={`Conversations (${data.interactions.length})`}>
            {data.interactions.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No conversations logged yet" />
            ) : (
              <Timeline
                items={data.interactions.map((interaction) => ({
                  color: interaction.direction === 'inbound' ? 'green' : 'blue',
                  children: (
                    <Flex justify="space-between" gap={8}>
                      <Space direction="vertical" size={0}>
                        <Typography.Text strong>
                          {interaction.direction === 'inbound' ? 'They reached out' : 'You reached out'}
                          {' via '}
                          {CHANNEL_LABELS[interaction.channel]}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {interaction.occurredOn}
                        </Typography.Text>
                        <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{interaction.summary}</Typography.Text>
                        {interaction.applicationId && (
                          <Link to={`/applications/${interaction.applicationId}`} style={{ fontSize: 12 }}>
                            About an application
                          </Link>
                        )}
                      </Space>
                      <Popconfirm
                        title="Delete this conversation?"
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => removeInteraction.mutate(interaction.id)}
                      >
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Flex>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>

      <ContactDrawer open={editing} onClose={() => setEditing(false)} contact={data} />
      <InteractionModal open={logging} contact={data} onClose={() => setLogging(false)} />
    </Space>
  );
}
