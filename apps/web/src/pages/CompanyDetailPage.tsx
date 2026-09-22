/**
 * One company: everything you have ever applied for there, plus its notes.
 *
 * This page is the answer to "should I apply here again?" — the full history in one place,
 * which is what makes the pattern visible.
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Empty,
  List,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  PushpinFilled,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { JobApplicationView, Note } from '@jobtrack/shared';
import { useCompany, useDeleteNote, useNotes, useTags, useUpdateCompany } from '../api/hooks.js';
import { StatusTag } from '../components/StatusTag.js';
import { NoteModal } from '../components/NoteModal.js';
import { CompanyPeopleCard } from '../components/PeopleCard.js';
import { palette } from '../theme.js';

export function CompanyDetailPage() {
  const { t } = useTranslation('companies');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { data, isLoading } = useCompany(id);
  const { data: noteData } = useNotes(id ? { targetType: 'company', targetId: id } : {});
  const { data: tagData } = useTags();
  const updateCompany = useUpdateCompany();
  const removeNote = useDeleteNote();
  const [noteEditing, setNoteEditing] = useState<Note | null>(null);
  const [addingNote, setAddingNote] = useState(false);

  if (isLoading || !data) return <Skeleton active paragraph={{ rows: 8 }} />;

  const { company, applications } = data;
  const active = applications.filter((a) =>
    ['applied', 'screening', 'interview'].includes(a.status),
  ).length;

  const columns: ColumnsType<JobApplicationView> = [
    { title: t('detail.history.columns.applied'), dataIndex: 'appliedOn', width: 120 },
    {
      title: t('detail.history.columns.jobTitle'),
      dataIndex: 'jobTitle',
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: t('detail.history.columns.status'),
      dataIndex: 'status',
      width: 120,
      render: (_, row) => <StatusTag status={row.status} />,
    },
    { title: t('detail.history.columns.source'), dataIndex: 'sourceName', width: 130 },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space direction="vertical" size={4}>
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          style={{ padding: 0 }}
          onClick={() => navigate('/companies')}
        >
          {t('detail.backToCompanies')}
        </Button>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {company.name}
        </Typography.Title>
        {company.website && (
          <Typography.Link href={company.website} target="_blank">
            {company.website}
          </Typography.Link>
        )}
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title={t('detail.stats.applications')} value={applications.length} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title={t('detail.stats.stillActive')} value={active} valueStyle={{ color: palette.accent }} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Typography.Text type="secondary">{t('detail.tags.title')}</Typography.Text>
              <Select
                mode="tags"
                style={{ width: '100%' }}
                placeholder={t('detail.tags.placeholder')}
                value={company.tags.map((tag) => tag.name)}
                options={(tagData?.tags ?? []).map((tag) => ({ value: tag.name, label: tag.name }))}
                onChange={(tags) => {
                  if (id) updateCompany.mutate({ id, body: { tags } });
                }}
              />
            </Space>
          </Card>
        </Col>
      </Row>

      <Card title={t('detail.history.title')}>
        <Table<JobApplicationView>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={applications}
          pagination={false}
          onRow={(row) => ({
            onClick: () => navigate(`/applications/${row.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      <CompanyPeopleCard companyName={company.name} />

      <Card
        title={t('detail.notes.title', { company: company.name })}
        extra={
          <Button size="small" icon={<PlusOutlined />} onClick={() => setAddingNote(true)}>
            {t('detail.notes.addButton')}
          </Button>
        }
      >
        {(noteData?.notes ?? []).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('detail.notes.empty')} />
        ) : (
          <List
            dataSource={noteData?.notes ?? []}
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
                    title={t('detail.notes.deleteConfirmTitle')}
                    okText={t('detail.notes.deleteConfirmOk')}
                    okButtonProps={{ danger: true }}
                    onConfirm={async () => {
                      await removeNote.mutateAsync(note.id);
                      message.success(t('detail.notes.deleteSuccess'));
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
                    <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                      {note.body}
                    </Typography.Paragraph>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <NoteModal
        open={addingNote || noteEditing !== null}
        note={noteEditing}
        target={{ type: 'company', id: company.id, label: company.name }}
        onClose={() => {
          setAddingNote(false);
          setNoteEditing(null);
        }}
      />
    </Space>
  );
}
