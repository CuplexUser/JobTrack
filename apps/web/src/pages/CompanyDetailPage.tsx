/**
 * One company: everything you have ever applied for there, plus its notes.
 *
 * This page is the answer to "should I apply here again?" — the full history in one place,
 * which is what makes the pattern visible.
 */

import { useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  Col,
  Empty,
  Flex,
  List,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import type { JobApplicationView } from '@jobtrack/shared';
import { useCompany, useNotes, useTags, useUpdateCompany } from '../api/hooks.js';
import { StatusTag } from '../components/StatusTag.js';
import { palette } from '../theme.js';

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useCompany(id);
  const { data: noteData } = useNotes(id ? { targetType: 'company', targetId: id } : {});
  const { data: tagData } = useTags();
  const updateCompany = useUpdateCompany();

  if (isLoading || !data) return <Skeleton active paragraph={{ rows: 8 }} />;

  const { company, applications } = data;
  const active = applications.filter((a) =>
    ['applied', 'screening', 'interview'].includes(a.status),
  ).length;

  const columns: ColumnsType<JobApplicationView> = [
    { title: 'Applied', dataIndex: 'appliedOn', width: 120 },
    {
      title: 'Job title',
      dataIndex: 'jobTitle',
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (_, row) => <StatusTag status={row.status} />,
    },
    { title: 'Source', dataIndex: 'sourceName', width: 130 },
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
          Back to companies
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
            <Statistic title="Applications" value={applications.length} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="Still active" value={active} valueStyle={{ color: palette.accent }} />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Typography.Text type="secondary">Company tags</Typography.Text>
              <Select
                mode="tags"
                style={{ width: '100%' }}
                placeholder="fintech, remote-first…"
                value={company.tags.map((t) => t.name)}
                options={(tagData?.tags ?? []).map((t) => ({ value: t.name, label: t.name }))}
                onChange={(tags) => {
                  if (id) updateCompany.mutate({ id, body: { tags } });
                }}
              />
            </Space>
          </Card>
        </Col>
      </Row>

      <Card title="Application history">
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

      <Card title={`Notes about ${company.name}`}>
        {(noteData?.notes ?? []).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notes about this company" />
        ) : (
          <List
            dataSource={noteData?.notes ?? []}
            renderItem={(note) => (
              <List.Item>
                <List.Item.Meta
                  title={note.title}
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
    </Space>
  );
}
