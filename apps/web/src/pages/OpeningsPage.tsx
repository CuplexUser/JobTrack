/**
 * Saved opportunities — things worth revisiting when there is time or the missing details
 * show up. The one action that matters here is Convert: it hands the opening's fields to
 * the same `createApplication` path the New Application form uses, then archives the
 * opening rather than deleting it.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Empty,
  Flex,
  Form,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WORK_MODE_LABELS,
  type JobOpeningView,
} from '@jobtrack/shared';
import { useConvertOpening, useDeleteOpening, useOpenings, useTags } from '../api/hooks.js';
import { OpeningDrawer } from '../components/OpeningDrawer.js';

interface ConvertFormValues {
  appliedOn: Dayjs;
  status: string;
  tags: string[];
}

export function OpeningsPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const { data, isLoading } = useOpenings();
  const { data: tagData } = useTags();
  const deleteOpening = useDeleteOpening();
  const convertOpening = useConvertOpening();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<JobOpeningView | undefined>(undefined);
  const [converting, setConverting] = useState<JobOpeningView | null>(null);
  const [form] = Form.useForm<ConvertFormValues>();

  function openConvert(opening: JobOpeningView): void {
    setConverting(opening);
    form.setFieldsValue({ appliedOn: dayjs(), status: 'applied', tags: [] });
  }

  async function handleConvert(values: ConvertFormValues): Promise<void> {
    if (!converting) return;
    try {
      const application = await convertOpening.mutateAsync({
        id: converting.id,
        body: {
          appliedOn: values.appliedOn.format('YYYY-MM-DD'),
          status: values.status,
          tags: values.tags ?? [],
        },
      });
      message.success('Converted to an application');
      setConverting(null);
      navigate(`/applications/${application.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not convert');
    }
  }

  const columns: ColumnsType<JobOpeningView> = [
    { title: 'Company', dataIndex: ['company', 'name'] },
    { title: 'Job title', dataIndex: 'jobTitle' },
    { title: 'Found on', dataIndex: 'savedOn', width: 120 },
    {
      title: 'Location',
      key: 'location',
      render: (_, row) =>
        [row.location, WORK_MODE_LABELS[row.workMode]].filter(Boolean).join(' · ') || (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    { title: 'Source', dataIndex: 'sourceName', render: (v: string | null) => v ?? '—' },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_, row) => (
        <Space onClick={(event) => event.stopPropagation()}>
          <Button size="small" icon={<SwapOutlined />} onClick={() => openConvert(row)}>
            Convert
          </Button>
          <Button
            size="small"
            onClick={() => {
              setEditing(row);
              setDrawerOpen(true);
            }}
          >
            Edit
          </Button>
          <Popconfirm
            title="Delete this opening?"
            onConfirm={() => deleteOpening.mutate(row.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center">
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Job openings
          </Typography.Title>
          <Typography.Text type="secondary">
            Saved for later — convert one to a real application when you're ready to apply.
          </Typography.Text>
        </Space>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(undefined);
            setDrawerOpen(true);
          }}
        >
          Save opening for later
        </Button>
      </Flex>

      <Card size="small">
        <Table<JobOpeningView>
          rowKey="id"
          columns={columns}
          dataSource={data?.openings ?? []}
          loading={isLoading}
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Nothing saved yet — use “Save opening for later” for a role you're not ready to apply to."
              />
            ),
          }}
        />
      </Card>

      <OpeningDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} opening={editing} />

      <Modal
        title={converting ? `Convert "${converting.jobTitle}" at ${converting.company.name}` : ''}
        open={Boolean(converting)}
        onCancel={() => setConverting(null)}
        onOk={() => form.submit()}
        okText="Create application"
        confirmLoading={convertOpening.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleConvert}>
          <Form.Item name="appliedOn" label="Applied on" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="status" label="Status">
            <Select options={APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
          </Form.Item>
          <Form.Item name="tags" label="Tags">
            <Select
              mode="tags"
              options={(tagData?.tags ?? []).map((tag) => ({ value: tag.name, label: tag.name }))}
              placeholder="fintech, remote-ok…"
              tokenSeparators={[',']}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
