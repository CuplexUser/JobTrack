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
  Input,
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
import {
  ImportOutlined,
  LinkOutlined,
  PlusOutlined,
  RollbackOutlined,
  SearchOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { Trans, useTranslation } from 'react-i18next';
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WORK_MODE_LABELS,
  locationKey,
  matchesAnyLocation,
  normalizeText,
  type RankedOpening,
  type PostingDraft,
} from '@jobtrack/shared';
import {
  useConvertOpening,
  useDeleteOpening,
  useOpenings,
  useTags,
  useUpdateOpening,
} from '../api/hooks.js';
import { OpeningDrawer } from '../components/OpeningDrawer.js';
import { PostingIngestModal } from '../components/PostingIngestModal.js';
import { FitBadge } from '../components/FitBadge.js';
import { parse, usePreference } from '../preferences.js';

interface ConvertFormValues {
  appliedOn: Dayjs;
  status: string;
  tags: string[];
}

type OpeningsView = 'active' | 'archived';
type OpeningsOrder = 'newest' | 'fit';

export function OpeningsPage() {
  const { t } = useTranslation('openings');
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [view, setView] = usePreference<OpeningsView>('filters', 'openings.view', 'active', parse.oneOf(['active', 'archived']));
  // Fetched once, active and archived together, so the Active/Archived counts on the
  // segmented control are both known without a second request when the tab is switched.
  const { data, isLoading } = useOpenings({ archived: true });
  const { data: tagData } = useTags();
  const deleteOpening = useDeleteOpening();
  const convertOpening = useConvertOpening();
  const updateOpening = useUpdateOpening();

  const [locations, setLocations] = usePreference<string[]>('filters', 'openings.locations', [], parse.strings);
  const [order, setOrder] = usePreference<OpeningsOrder>('view', 'openings.order', 'newest', parse.oneOf(['newest', 'fit']));
  const [q, setQ] = usePreference<string>('filters', 'openings.q', '', parse.string);

  const activeOpenings = useMemo(() => (data?.openings ?? []).filter((o) => !o.archived), [data]);
  const archivedOpenings = useMemo(() => (data?.openings ?? []).filter((o) => o.archived), [data]);
  const inView = view === 'archived' ? archivedOpenings : activeOpenings;

  // Filtered here rather than by the API: the page already holds every opening in this
  // view, `matchesAnyLocation` is the same rule the API applies, and the search words are
  // matched over the same fields `listOpenings`' `q` filter checks server-side.
  const rows = useMemo(() => {
    const words = normalizeText(q).split(' ').filter(Boolean);
    const matching = inView.filter((opening) => {
      if (!matchesAnyLocation(opening.location, locations)) return false;
      if (words.length === 0) return true;
      const haystack = normalizeText(
        [opening.jobTitle, opening.company.name, opening.location, opening.notes].filter(Boolean).join(' '),
      );
      return words.every((word) => haystack.includes(word));
    });
    // The API already scored every opening; ranking is only a different order of the same rows.
    return order === 'fit' ? [...matching].sort((a, b) => (b.fit?.score ?? -1) - (a.fit?.score ?? -1)) : matching;
  }, [inView, locations, q, order]);

  /** Fit is null on every opening when the user has not filled in a profile yet. */
  const hasProfile = inView.some((opening) => opening.fit !== null);

  /** The locations in this view, grouped like the applications filter, most used first. */
  const locationOptions = useMemo(() => {
    const groups = new Map<string, { label: string; count: number }>();
    for (const opening of inView) {
      const label = opening.location?.replace(/\s+/g, ' ').trim();
      if (!label) continue;
      const group = groups.get(locationKey(label)) ?? { label, count: 0 };
      group.count += 1;
      groups.set(locationKey(label), group);
    }
    return [...groups.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .map((group) => ({ value: group.label, label: `${group.label} (${group.count})` }));
  }, [inView]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  /** Set when the drawer was opened from a captured posting rather than from scratch. */
  const [draft, setDraft] = useState<PostingDraft | undefined>(undefined);
  const [editing, setEditing] = useState<RankedOpening | undefined>(undefined);
  const [converting, setConverting] = useState<RankedOpening | null>(null);
  const [form] = Form.useForm<ConvertFormValues>();

  function openConvert(opening: RankedOpening): void {
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
      message.success(t('page.convertedMessage'));
      setConverting(null);
      navigate(`/applications/${application.id}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('page.convertError'));
    }
  }

  async function handleRestore(row: RankedOpening): Promise<void> {
    try {
      await updateOpening.mutateAsync({ id: row.id, body: { archived: false } });
      message.success(t('page.restoredMessage'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('page.restoreError'));
    }
  }

  const baseColumns: ColumnsType<RankedOpening> = [
    ...(hasProfile
      ? [{ title: t('page.columns.fit'), key: 'fit', width: 70, render: (_: unknown, row: RankedOpening) => <FitBadge fit={row.fit} /> }]
      : []),
    { title: t('page.columns.company'), dataIndex: ['company', 'name'] },
    { title: t('page.columns.jobTitle'), dataIndex: 'jobTitle' },
    { title: t('page.columns.foundOn'), dataIndex: 'savedOn', width: 120 },
    {
      title: t('page.columns.location'),
      key: 'location',
      render: (_, row) =>
        [row.location, WORK_MODE_LABELS[row.workMode]].filter(Boolean).join(' · ') || (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    { title: t('page.columns.source'), dataIndex: 'sourceName', render: (v: string | null) => v ?? '—' },
  ];

  const jobUrlButton = (row: RankedOpening) =>
    row.jobUrl && (
      <Tooltip title={t('page.openPosting')}>
        <Button
          size="small"
          icon={<LinkOutlined />}
          href={row.jobUrl}
          target="_blank"
          rel="noreferrer"
        />
      </Tooltip>
    );

  const deleteButton = (row: RankedOpening) => (
    <Popconfirm
      title={t('page.deleteConfirmTitle')}
      description={t('page.deleteConfirmDescription')}
      onConfirm={() => deleteOpening.mutate(row.id)}
      okText={t('page.delete')}
      okButtonProps={{ danger: true }}
    >
      <Button size="small" danger>
        {t('page.delete')}
      </Button>
    </Popconfirm>
  );

  const activeColumns: ColumnsType<RankedOpening> = [
    ...baseColumns,
    {
      title: '',
      key: 'actions',
      width: 260,
      render: (_, row) => (
        <Space onClick={(event) => event.stopPropagation()}>
          {jobUrlButton(row)}
          <Button size="small" icon={<SwapOutlined />} onClick={() => openConvert(row)}>
            {t('page.convert')}
          </Button>
          <Button
            size="small"
            onClick={() => {
              setEditing(row);
              setDraft(undefined);
              setDrawerOpen(true);
            }}
          >
            {t('page.edit')}
          </Button>
          {deleteButton(row)}
        </Space>
      ),
    },
  ];

  const archivedColumns: ColumnsType<RankedOpening> = [
    ...baseColumns,
    {
      title: t('page.columns.archivedBecause'),
      key: 'reason',
      width: 160,
      render: (_, row) =>
        row.convertedApplicationId ? (
          <Link to={`/applications/${row.convertedApplicationId}`}>
            <Tag color="blue">{t('page.converted')}</Tag>
          </Link>
        ) : (
          <Tag>{t('page.archivedByHand')}</Tag>
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
            {t('page.restore')}
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
            {t('page.title')}
          </Typography.Title>
          <Typography.Text type="secondary">
            {view === 'active' ? t('page.subtitleActive') : t('page.subtitleArchived')}
          </Typography.Text>
        </Space>
        <Space>
          <Button icon={<ImportOutlined />} onClick={() => setIngestOpen(true)}>
            {t('page.saveFromPosting')}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(undefined);
              setDraft(undefined);
              setDrawerOpen(true);
            }}
          >
            {t('page.saveForLater')}
          </Button>
        </Space>
      </Flex>

      <Flex gap={12} wrap align="center">
        <Segmented<OpeningsView>
          value={view}
          onChange={setView}
          options={[
            { label: t('page.active', { count: activeOpenings.length }), value: 'active' },
            { label: t('page.archived', { count: archivedOpenings.length }), value: 'archived' },
          ]}
        />
        <Input
          allowClear
          placeholder={t('page.searchPlaceholder')}
          prefix={<SearchOutlined />}
          style={{ minWidth: 260 }}
          defaultValue={q}
          onChange={(event) => {
            if (event.target.value === '') setQ('');
          }}
          onPressEnter={(event) => setQ((event.target as HTMLInputElement).value)}
        />
        <Select
          // `tags` mode: pick a location from this list, or type any fragment ("Sweden").
          mode="tags"
          allowClear
          placeholder={t('page.locationPlaceholder')}
          style={{ minWidth: 220 }}
          value={locations}
          onChange={(value: string[]) => setLocations(value.map((v) => v.trim()).filter(Boolean))}
          optionFilterProp="value"
          options={locationOptions}
        />
        {hasProfile ? (
          <Segmented
            value={order}
            onChange={(value) => setOrder(value as OpeningsOrder)}
            options={[
              { label: t('page.sortNewest'), value: 'newest' },
              { label: t('page.sortFit'), value: 'fit' },
            ]}
          />
        ) : (
          inView.length > 0 && (
            <Typography.Text type="secondary">
              <Trans i18nKey="page.fillProfile" t={t} components={{ link: <Link to="/settings" /> }} />
            </Typography.Text>
          )
        )}
      </Flex>

      <Card size="small">
        <Table<RankedOpening>
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
                  q || locations.length > 0
                    ? t('page.emptySearch')
                    : view === 'active'
                      ? t('page.emptyActive', { action: t('page.saveForLater') })
                      : t('page.emptyArchived')
                }
              />
            ),
          }}
        />
      </Card>

      <OpeningDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDraft(undefined);
        }}
        opening={editing}
        draft={draft}
      />

      <PostingIngestModal
        open={ingestOpen}
        onClose={() => setIngestOpen(false)}
        onUse={(parsed) => {
          setIngestOpen(false);
          setEditing(undefined);
          setDraft(parsed);
          setDrawerOpen(true);
        }}
      />

      <Modal
        title={converting ? t('page.convertModalTitle', { jobTitle: converting.jobTitle, companyName: converting.company.name }) : ''}
        open={Boolean(converting)}
        onCancel={() => setConverting(null)}
        onOk={() => form.submit()}
        okText={t('page.createApplication')}
        confirmLoading={convertOpening.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleConvert}>
          <Form.Item name="appliedOn" label={t('page.appliedOnLabel')} rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="status" label={t('page.statusLabel')}>
            <Select options={APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
          </Form.Item>
          <Form.Item name="tags" label={t('page.tagsLabel')}>
            <Select
              mode="tags"
              options={(tagData?.tags ?? []).map((tag) => ({ value: tag.name, label: tag.name }))}
              placeholder={t('page.tagsPlaceholder')}
              tokenSeparators={[',']}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
