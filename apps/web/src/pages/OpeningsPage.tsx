/**
 * Saved opportunities — things worth revisiting when there is time or the missing details
 * show up. The one action that matters here is Convert: it hands the opening's fields to
 * the same `createApplication` path the New Application form uses, then archives the
 * opening rather than deleting it.
 *
 * The Active/Archived switch surfaces openings that have been archived — either converted
 * into an application, or archived by hand (from here or the MCP tools). Archived openings
 * can be restored or deleted for good.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LinkOutlined, PlusOutlined, RollbackOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WORK_MODE_LABELS,
  type JobOpeningView,
} from '@jobtrack/shared';
import {
  useConvertOpening,
  useDeleteOpening,
  useOpenings,
  useTags,
  useUpdateOpening,
} from '../api/hooks.js';
import { OpeningDrawer } from '../components/OpeningDrawer.js';

interface ConvertFormValues {
  appliedOn: Dayjs;
  status: string;
  tags: string[];
}

type OpeningsView = 'active' | 'archived';

export function OpeningsPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [view, setView] = useState<OpeningsView>('active');
  // `archived=true` returns active *and* archived, so the archived view still filters locally.
  const { data, isLoading } = useOpenings(view === 'archived' ? { archived: true } : {});
  const { data: tagData } = useTags();
  const deleteOpening = useDeleteOpening();
  const convertOpening = useConvertOpening();
  const updateOpening = useUpdateOpening();

  const rows = useMemo(() => {
    const all = data?.openings ?? [];
    return view === 'archived' ? all.filter((o) => o.archived) : all;
  }, [data, view]);

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

  async function handleRestore(row: JobOpeningView): Promise<void> {
    try {
      await updateOpening.mutateAsync({ id: row.id, body: { archived: false } });
      message.success('Opening restored');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not restore');
    }
  }

  const baseColumns: ColumnsType<JobOpeningView> = [
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
  ];

  const jobUrlButton = (row: JobOpeningView) =>
    row.jobUrl && (
      <Tooltip title="Open job posting">
        <Button
          size="small"
          icon={<LinkOutlined />}
          href={row.jobUrl}
          target="_blank"
          rel="noreferrer"
        />
      </Tooltip>
    );

  const deleteButton = (row: JobOpeningView) => (
    <Popconfirm
      title="Delete this opening?"
      description="This removes it for good and cannot be undone."
      onConfirm={() => deleteOpening.mutate(row.id)}
      okText="Delete"
      okButtonProps={{ danger: true }}
    >
      <Button size="small" danger>
        Delete
      </Button>
    </Popconfirm>
  );

  const activeColumns: ColumnsType<JobOpeningView> = [
    ...baseColumns,
    {
      title: '',
      key: 'actions',
      width: 260,
      render: (_, row) => (
        <Space onClick={(event) => event.stopPropagation()}>
          {jobUrlButton(row)}
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
          {deleteButton(row)}
        </Space>
      ),
    },
  ];

  const archivedColumns: ColumnsType<JobOpeningView> = [
    ...baseColumns,
    {
      title: 'Archived because',
      key: 'reason',
      width: 160,
      render: (_, row) =>
        row.convertedApplicationId ? (
          <Link to={`/applications/${row.convertedApplicationId}`}>
            <Tag color="blue">Converted</Tag>
          </Link>
        ) : (
          <Tag>Archived by hand</Tag>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_, row) => (
        <Space onClick={(event) => event.stopPropagation()}>
          {jobUrlButton(row)}
          <Button
            size="small"
            icon={<RollbackOutlined />}
            loading={updateOpening.isPending}
            onClick={() => handleRestore(row)}
          >
            Restore
          </Button>
          {deleteButton(row)}
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
            {view === 'active'
              ? "Saved for later — convert one to a real application when you're ready to apply."
              : 'Openings that were converted into an application or archived by hand.'}
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

      <Segmented<OpeningsView>
        value={view}
        onChange={setView}
        options={[
          { label: 'Active', value: 'active' },
          { label: 'Archived', value: 'archived' },
        ]}
      />

      <Card size="small">
        <Table<JobOpeningView>
          rowKey="id"
          columns={view === 'archived' ? archivedColumns : activeColumns}
          dataSource={rows}
          loading={isLoading}
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  view === 'active'
                    ? "Nothing saved yet — use “Save opening for later” for a role you're not ready to apply to."
                    : 'No archived openings.'
                }
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
