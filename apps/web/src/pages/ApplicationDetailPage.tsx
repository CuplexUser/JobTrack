/**
 * One application in full, with its status history and linked notes.
 *
 * The status timeline is the reason the app records events rather than just a current
 * status: "rejected" on its own tells you nothing, but "applied → screening → interview →
 * rejected, over five weeks" tells you where it actually went wrong.
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
  Select,
  Skeleton,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  PushpinFilled,
} from '@ant-design/icons';
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WORK_MODE_LABELS,
  nextStatus,
  type Note,
} from '@jobtrack/shared';
import {
  useApplication,
  useChangeStatus,
  useDeleteApplication,
  useDeleteNote,
} from '../api/hooks.js';
import { StatusTag } from '../components/StatusTag.js';
import { ApplicationDrawer } from '../components/ApplicationDrawer.js';
import { NoteModal } from '../components/NoteModal.js';

export function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { data, isLoading } = useApplication(id);
  const changeStatus = useChangeStatus();
  const remove = useDeleteApplication();
  const removeNote = useDeleteNote();
  const [editing, setEditing] = useState(false);
  const [noteEditing, setNoteEditing] = useState<Note | null>(null);
  const [addingNote, setAddingNote] = useState(false);

  if (isLoading || !data) return <Skeleton active paragraph={{ rows: 10 }} />;

  const advance = nextStatus(data.status);

  async function setStatus(status: string): Promise<void> {
    if (!id) return;
    await changeStatus.mutateAsync({ id, body: { status, comment: null } });
    message.success(`Moved to ${STATUS_LABELS[status as never]}`);
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="flex-start" wrap gap={12}>
        <Space direction="vertical" size={4}>
          <Button
            type="link"
            icon={<ArrowLeftOutlined />}
            style={{ padding: 0 }}
            onClick={() => navigate('/applications')}
          >
            Back to applications
          </Button>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {data.jobTitle}
          </Typography.Title>
          <Space size={8} wrap>
            <Link to={`/companies/${data.company.id}`}>{data.company.name}</Link>
            <Typography.Text type="secondary">applied {data.appliedOn}</Typography.Text>
            <StatusTag status={data.status} />
          </Space>
        </Space>

        <Space wrap>
          {advance && (
            <Button type="primary" onClick={() => void setStatus(advance)}>
              Move to {STATUS_LABELS[advance]}
            </Button>
          )}
          <Select
            style={{ width: 150 }}
            value={data.status}
            onChange={(value) => void setStatus(value)}
            options={APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          />
          <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Popconfirm
            title="Delete this application?"
            description="Its notes and status history go too. This cannot be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              if (!id) return;
              await remove.mutateAsync(id);
              message.success('Application deleted');
              navigate('/applications');
            }}
          >
            <Button danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </Flex>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="Details">
            <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
              <Descriptions.Item label="Company">{data.company.name}</Descriptions.Item>
              <Descriptions.Item label="Applied on">{data.appliedOn}</Descriptions.Item>
              <Descriptions.Item label="Location">{data.location ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Work mode">
                {WORK_MODE_LABELS[data.workMode]}
              </Descriptions.Item>
              <Descriptions.Item label="Source">{data.sourceName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Follow up">{data.followUpOn ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Salary" span={2}>
                {data.salaryMin || data.salaryMax
                  ? `${data.salaryMin?.toLocaleString() ?? '?'} – ${data.salaryMax?.toLocaleString() ?? '?'} ${data.salaryCurrency ?? ''}`
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Posting" span={2}>
                {data.jobUrl ? (
                  <a href={data.jobUrl} target="_blank" rel="noreferrer">
                    <Space size={4}>
                      <LinkOutlined />
                      {data.jobUrl}
                    </Space>
                  </a>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Tags" span={2}>
                {data.tags.length > 0 ? (
                  <Space size={4} wrap>
                    {data.tags.map((tag) => (
                      <Tag key={tag.id}>{tag.name}</Tag>
                    ))}
                  </Space>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title="Status history">
              {data.statusEvents.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No changes recorded" />
              ) : (
                <Timeline
                  items={data.statusEvents.map((event) => ({
                    color:
                      event.toStatus === 'offer'
                        ? 'green'
                        : event.toStatus === 'rejected'
                          ? 'red'
                          : 'blue',
                    children: (
                      <Space direction="vertical" size={0}>
                        <Typography.Text strong>
                          {event.fromStatus
                            ? `${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}`
                            : `Applied`}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {event.occurredOn}
                        </Typography.Text>
                        {event.comment && <Typography.Text>{event.comment}</Typography.Text>}
                      </Space>
                    ),
                  }))}
                />
              )}
            </Card>

            <Card
              title={`Notes (${data.notes.length})`}
              extra={
                <Button size="small" icon={<PlusOutlined />} onClick={() => setAddingNote(true)}>
                  Add note
                </Button>
              }
            >
              {data.notes.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notes yet" />
              ) : (
                <List
                  size="small"
                  dataSource={data.notes}
                  renderItem={(note) => (
                    <List.Item
                      actions={[
                        <Button
                          key="edit"
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => setNoteEditing(note)}
                        />,
                        <Popconfirm
                          key="delete"
                          title="Delete this note?"
                          okText="Delete"
                          okButtonProps={{ danger: true }}
                          onConfirm={async () => {
                            await removeNote.mutateAsync(note.id);
                            message.success('Note deleted');
                          }}
                        >
                          <Button type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={8}>
                            {note.pinned && <PushpinFilled style={{ color: '#faad14' }} />}
                            <Typography.Text strong>{note.title}</Typography.Text>
                          </Space>
                        }
                        description={
                          <Typography.Paragraph
                            style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
                            ellipsis={{ rows: 4, expandable: true, symbol: 'more' }}
                          >
                            {note.body}
                          </Typography.Paragraph>
                        }
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Space>
        </Col>
      </Row>

      <ApplicationDrawer open={editing} onClose={() => setEditing(false)} application={data} />

      <NoteModal
        open={addingNote || noteEditing !== null}
        note={noteEditing}
        target={{ type: 'application', id: data.id, label: data.jobTitle }}
        onClose={() => {
          setAddingNote(false);
          setNoteEditing(null);
        }}
      />
    </Space>
  );
}
