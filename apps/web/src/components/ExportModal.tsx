/**
 * Choose what an export carries before downloading it: the format, which columns, in which
 * order, and what each column's header says.
 *
 * The choices are the export profile, saved in the database on every export so the next one,
 * from any browser, starts where this one left off. A header left blank follows the active
 * language ("Company" in English, "Företag" in Swedish); one typed by hand stays as typed.
 *
 * What gets exported is still exactly what the list is showing: the filter is passed through
 * untouched, only the columns change.
 */

import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HolderOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Checkbox, Flex, Input, Modal, Segmented, Spin, Typography, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  EXPORT_HEADER_MAX,
  defaultExportColumns,
  type ExportColumnSetting,
  type ExportFormat,
  type ExportProfile,
} from '@jobtrack/shared';
import { useExportProfile, useSaveExportProfile } from '../api/hooks.js';
import type { ExportLayout } from '../api/index.js';

export interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  /** How many applications the current view holds, for the summary line. */
  count: number | undefined;
  /** Formats that can be offered; the demo has no Excel export. */
  formats: readonly ExportFormat[];
  /** Starts the download. Called after the profile is handed off to be saved. */
  onExport: (format: ExportFormat, layout: ExportLayout) => void;
}

export function ExportModal({ open, onClose, count, formats, onExport }: ExportModalProps) {
  const { t } = useTranslation('applications');
  const { data: profile, isLoading } = useExportProfile();

  return (
    <Modal open={open} onCancel={onClose} title={t('export.title')} footer={null} width={560} destroyOnHidden>
      {isLoading || !profile ? (
        <Flex justify="center" style={{ padding: 32 }}>
          <Spin />
        </Flex>
      ) : (
        <ExportForm profile={profile} count={count} formats={formats} onClose={onClose} onExport={onExport} />
      )}
    </Modal>
  );
}

interface ExportFormProps extends Omit<ExportModalProps, 'open'> {
  profile: ExportProfile;
}

function ExportForm({ profile, count, formats, onClose, onExport }: ExportFormProps) {
  const { t } = useTranslation('applications');
  const { message } = AntApp.useApp();
  const save = useSaveExportProfile();
  const [format, setFormat] = useState<ExportFormat>(
    formats.includes(profile.format) ? profile.format : formats[0]!,
  );
  const [columns, setColumns] = useState<ExportColumnSetting[]>(profile.columns);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const defaultHeader = (column: ExportColumnSetting) => t(`export.field.${column.field}`);
  const enabled = columns.filter((column) => column.enabled);

  function patch(field: ExportColumnSetting['field'], change: Partial<ExportColumnSetting>) {
    setColumns((current) => current.map((column) => (column.field === field ? { ...column, ...change } : column)));
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    setColumns((current) => {
      const from = current.findIndex((column) => column.field === active.id);
      const to = current.findIndex((column) => column.field === over.id);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
  }

  function handleExport() {
    // A header typed to read exactly like the default is the default, so it keeps following
    // the language rather than freezing in the one it was typed in.
    const saved = columns.map((column) => {
      const header = column.header?.trim() ?? '';
      return { ...column, header: header === '' || header === defaultHeader(column) ? null : header };
    });
    save.mutate(
      { format, columns: saved },
      { onError: () => void message.warning(t('export.saveFailed')) },
    );
    const chosen = saved.filter((column) => column.enabled);
    onExport(format, {
      columns: chosen.map((column) => column.field),
      headers: chosen.map((column) => column.header ?? defaultHeader(column)),
    });
    onClose();
  }

  return (
    <Flex vertical gap={16}>
      <Typography.Text type="secondary">
        {count === undefined ? t('export.summaryUnknown') : t('export.summary', { count })}
      </Typography.Text>

      {formats.length > 1 && (
        <Segmented<ExportFormat>
          value={format}
          onChange={setFormat}
          options={formats.map((value) => ({ value, label: t(`export.format.${value}`) }))}
        />
      )}

      <Flex vertical gap={4}>
        <Flex justify="space-between" align="baseline">
          <Typography.Text strong>{t('export.columnsTitle')}</Typography.Text>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setColumns(defaultExportColumns())}>
            {t('export.reset')}
          </Button>
        </Flex>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('export.columnsHelp')}
        </Typography.Text>
      </Flex>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={columns.map((column) => column.field)} strategy={verticalListSortingStrategy}>
          <Flex vertical gap={4}>
            {columns.map((column) => (
              <ColumnRow
                key={column.field}
                column={column}
                label={defaultHeader(column)}
                onToggle={(on) => patch(column.field, { enabled: on })}
                onHeader={(header) => patch(column.field, { header })}
              />
            ))}
          </Flex>
        </SortableContext>
      </DndContext>

      <Flex justify="flex-end" gap={8}>
        <Button onClick={onClose}>{t('export.cancel')}</Button>
        <Button type="primary" disabled={enabled.length === 0} onClick={handleExport}>
          {t('export.submit', { count: enabled.length })}
        </Button>
      </Flex>
    </Flex>
  );
}

interface ColumnRowProps {
  column: ExportColumnSetting;
  /** The field's name in the active language, also its header when none was typed. */
  label: string;
  onToggle: (enabled: boolean) => void;
  onHeader: (header: string) => void;
}

function ColumnRow({ column, label, onToggle, onHeader }: ColumnRowProps) {
  const { t } = useTranslation('applications');
  const { token } = theme.useToken();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: column.field,
  });

  return (
    <Flex
      ref={setNodeRef}
      align="center"
      gap={8}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        padding: '4px 8px',
        borderRadius: token.borderRadius,
        background: isDragging ? token.colorFillSecondary : token.colorFillQuaternary,
        position: 'relative',
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <span
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t('export.dragHandle', { column: label })}
        style={{ cursor: 'grab', color: token.colorTextTertiary, display: 'flex', touchAction: 'none' }}
      >
        <HolderOutlined />
      </span>
      <Checkbox checked={column.enabled} onChange={(event) => onToggle(event.target.checked)} style={{ width: 150 }}>
        {label}
      </Checkbox>
      <Input
        size="small"
        value={column.header ?? ''}
        placeholder={label}
        maxLength={EXPORT_HEADER_MAX}
        disabled={!column.enabled}
        aria-label={t('export.headerFor', { column: label })}
        onChange={(event) => onHeader(event.target.value)}
        style={{ flex: 1 }}
      />
    </Flex>
  );
}
