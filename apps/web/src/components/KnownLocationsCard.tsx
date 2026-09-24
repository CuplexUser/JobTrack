/**
 * The places the profile's location input offers, in one list to tidy: add one ahead of
 * ranking it, fix a misspelling, or forget one. A rename or removal reaches into the
 * priority levels too, so a typo fixed here is fixed everywhere it was used.
 */

import { useMemo, useRef, useState } from 'react';
import { DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { App as AntApp, AutoComplete, Button, Card, Empty, Flex, Input, Popconfirm, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { findPlaceTier, locationKey } from '@jobtrack/shared';
import {
  useAddKnownLocation,
  useApplicationLocations,
  useKnownLocations,
  useProfile,
  useRemoveKnownLocation,
  useRenameKnownLocation,
} from '../api/hooks.js';

export function KnownLocationsCard() {
  const { t } = useTranslation('settings');
  const { message } = AntApp.useApp();
  const { data, isLoading } = useKnownLocations();
  const { data: profile } = useProfile();
  const { data: onFile } = useApplicationLocations();
  const add = useAddKnownLocation();
  const rename = useRenameKnownLocation();
  const remove = useRemoveKnownLocation();
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  // Set by onSelect, so Enter on a highlighted suggestion is not also taken as typed text.
  const selected = useRef(false);

  const places = useMemo(() => data?.places ?? [], [data]);
  const tiers = profile?.locationTiers ?? [];
  const knownKeys = useMemo(() => new Set(places.map(locationKey)), [places]);
  const needle = locationKey(filter);
  const rows = places.filter((place) => !needle || locationKey(place).includes(needle)).map((place) => ({ place, level: findPlaceTier(tiers, place) }));

  const draftKey = locationKey(draft);
  const suggestions = (onFile?.locations ?? [])
    .map((option) => option.label)
    .filter((label) => !knownKeys.has(locationKey(label)) && (!draftKey || locationKey(label).includes(draftKey)))
    .slice(0, 30)
    .map((label) => ({ value: label, label }));

  async function handleAdd(raw: string): Promise<void> {
    const place = raw.replace(/\s+/g, ' ').trim();
    if (!place) return;
    if (knownKeys.has(locationKey(place))) {
      message.info(t('locations.alreadyKnown', { place }));
      return;
    }
    try {
      await add.mutateAsync(place);
      setDraft('');
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('locations.saveError'));
    }
  }

  async function handleRename(from: string, raw: string): Promise<void> {
    const to = raw.replace(/\s+/g, ' ').trim();
    if (!to || to === from) return;
    const merging = locationKey(to) !== locationKey(from) && knownKeys.has(locationKey(to));
    try {
      await rename.mutateAsync({ from, to });
      message.success(merging ? t('locations.merged', { from, to }) : t('locations.renamed', { from, to }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('locations.saveError'));
    }
  }

  async function handleRemove(place: string): Promise<void> {
    try {
      await remove.mutateAsync(place);
      message.success(t('locations.removed', { place }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('locations.saveError'));
    }
  }

  return (
    <Card title={t('locations.title')} loading={isLoading}>
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('locations.description')}
        </Typography.Paragraph>

        <Flex gap={8} wrap>
          <AutoComplete
            value={draft}
            options={suggestions}
            onChange={setDraft}
            onSelect={(place: string) => {
              selected.current = true;
              void handleAdd(place);
            }}
            onInputKeyDown={(event) => {
              if (event.key !== 'Enter' || !draft.trim()) return;
              selected.current = false;
              const typed = draft;
              setTimeout(() => {
                if (!selected.current) void handleAdd(typed);
              }, 0);
            }}
            defaultActiveFirstOption={false}
            placeholder={t('locations.addPlaceholder')}
            style={{ flex: '1 1 240px', maxWidth: 360 }}
            aria-label={t('locations.addPlaceholder')}
          />
          <Button icon={<PlusOutlined />} loading={add.isPending} disabled={!draft.trim()} onClick={() => void handleAdd(draft)}>
            {t('locations.add')}
          </Button>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('locations.filter')}
            style={{ flex: '1 1 200px', maxWidth: 280, marginLeft: 'auto' }}
            aria-label={t('locations.filter')}
          />
        </Flex>

        <Table
          size="small"
          rowKey={(row) => locationKey(row.place)}
          dataSource={rows}
          pagination={rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(filter ? 'locations.noMatch' : 'locations.empty')} /> }}
          columns={[
            {
              key: 'place',
              title: t('locations.columns.place'),
              render: (_, row) => (
                <Typography.Text
                  editable={{
                    tooltip: t('locations.rename'),
                    triggerType: ['icon', 'text'],
                    onChange: (next) => void handleRename(row.place, next),
                  }}
                  style={{ marginBottom: 0 }}
                >
                  {row.place}
                </Typography.Text>
              ),
            },
            {
              key: 'level',
              title: t('locations.columns.level'),
              width: 160,
              render: (_, row) =>
                row.level >= 0 ? (
                  <Tag color="blue">{t('profile.locationTiers.level', { level: row.level + 1 })}</Tag>
                ) : (
                  <Typography.Text type="secondary">{t('locations.notRanked')}</Typography.Text>
                ),
            },
            {
              key: 'actions',
              width: 56,
              align: 'right',
              render: (_, row) => (
                <Popconfirm
                  title={t('locations.removeConfirm', { place: row.place })}
                  description={row.level >= 0 ? t('locations.removeRanked', { level: row.level + 1 }) : undefined}
                  okText={t('locations.remove')}
                  okButtonProps={{ danger: true }}
                  onConfirm={() => handleRemove(row.place)}
                >
                  <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={t('locations.remove')} />
                </Popconfirm>
              ),
            },
          ]}
        />
      </Flex>
    </Card>
  );
}
