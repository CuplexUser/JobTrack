/**
 * Import applications from a CSV/.xlsx in the same shape Export produces (Position, Company,
 * Location, Date, Status, Notes) — notably the app's own Export output. Location is optional,
 * so a file exported before that column existed still imports.
 *
 * Two steps, both hitting the same endpoint: choosing a file previews what would happen
 * without writing anything, and only committing actually creates the new rows. Rows that
 * exactly match an application already logged are skipped automatically — the preview shows
 * the count, not a row-by-row prompt.
 */

import { useState } from 'react';
import { Alert, Button, Modal, Result, Space, Table, Tag, Typography, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadProps } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { STATUS_LABELS, type ApplicationStatus } from '@jobtrack/shared';
import { api, type ImportCommitResponse, type ImportPreviewResponse, type ImportPreviewRow } from '../api/index.js';

const VERDICT_COLOR: Record<ImportPreviewRow['verdict'], string> = {
  new: 'green',
  duplicate: 'default',
  error: 'red',
};

export interface ImportModalProps {
  open: boolean;
  onClose: () => void;
}

export function ImportModal({ open, onClose }: ImportModalProps) {
  const { t } = useTranslation('import');
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  const beforeUpload: UploadProps['beforeUpload'] = (uploaded) => {
    const detectedFormat = uploaded.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
    setFile(uploaded);
    setFormat(detectedFormat);
    setError(null);
    setLoading(true);
    api
      .previewImport(uploaded, detectedFormat)
      .then(setPreview)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('applications.readError')))
      .finally(() => setLoading(false));
    return false; // Ant Design's own upload machinery never runs; the calls above own it.
  };

  async function handleCommit(): Promise<void> {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.commitImport(file, format);
      setResult(response);
      if (response.created > 0) {
        for (const key of ['applications', 'application', 'periods', 'dashboard', 'companies', 'company', 'search']) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('applications.importFailed'));
    } finally {
      setLoading(false);
    }
  }

  const columns: ColumnsType<ImportPreviewRow> = [
    { title: t('applications.columns.row'), dataIndex: 'rowNumber', width: 60 },
    { title: t('applications.columns.position'), dataIndex: 'jobTitle', ellipsis: true },
    { title: t('applications.columns.company'), dataIndex: 'companyName', ellipsis: true },
    { title: t('applications.columns.date'), dataIndex: 'appliedOn', width: 110 },
    {
      title: t('applications.columns.status'),
      dataIndex: 'status',
      width: 110,
      render: (value: ApplicationStatus | null) => (value ? STATUS_LABELS[value] : '—'),
    },
    {
      title: t('applications.columns.result'),
      dataIndex: 'verdict',
      width: 200,
      render: (verdict: ImportPreviewRow['verdict'], row) => (
        <Space direction="vertical" size={0}>
          <Tag color={VERDICT_COLOR[verdict]}>{t(`applications.verdict.${verdict}`)}</Tag>
          {row.errors.length > 0 && (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {row.errors.join('; ')}
            </Typography.Text>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Modal title={t('applications.title')} open={open} onCancel={handleClose} width={800} footer={null} destroyOnHidden>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {!preview && !result && (
          <>
            <Typography.Paragraph type="secondary">{t('applications.description')}</Typography.Paragraph>
            <Upload.Dragger accept=".csv,.xlsx" maxCount={1} showUploadList={false} beforeUpload={beforeUpload} disabled={loading}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">{t('applications.dropzone')}</p>
            </Upload.Dragger>
          </>
        )}

        {error && <Alert type="error" showIcon message={error} />}

        {preview && !result && (
          <>
            <Space wrap>
              <Tag color="green">{t('applications.newCount', { count: preview.totals.new })}</Tag>
              <Tag>{t('applications.duplicateCount', { count: preview.totals.duplicate })}</Tag>
              {preview.totals.error > 0 && <Tag color="red">{t('applications.errorCount', { count: preview.totals.error })}</Tag>}
            </Space>
            {preview.fileErrors.map((message) => (
              <Alert key={message} type="warning" showIcon message={message} />
            ))}
            <Table<ImportPreviewRow>
              size="small"
              rowKey="rowNumber"
              columns={columns}
              dataSource={preview.rows}
              pagination={{ pageSize: 10 }}
              scroll={{ y: 320 }}
            />
            <Space>
              <Button onClick={reset}>{t('applications.chooseAnother')}</Button>
              <Button type="primary" loading={loading} disabled={preview.totals.new === 0} onClick={handleCommit}>
                {t('applications.importButton', { count: preview.totals.new })}
              </Button>
            </Space>
          </>
        )}

        {result && (
          <Result
            status={result.failed > 0 ? 'warning' : 'success'}
            title={t('applications.resultTitle', { count: result.created })}
            subTitle={
              t('applications.skippedRows', { count: result.skipped }) +
              (result.failed > 0 ? t('applications.failedRows', { count: result.failed }) : '')
            }
            extra={
              <Button type="primary" onClick={handleClose}>
                {t('applications.done')}
              </Button>
            }
          />
        )}
      </Space>
    </Modal>
  );
}
