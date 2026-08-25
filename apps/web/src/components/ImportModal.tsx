/**
 * Import applications from a CSV/.xlsx in the same 5-column shape Export produces (Position,
 * Company, Date, Status, Notes) — notably the app's own Export output.
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
import { STATUS_LABELS, type ApplicationStatus } from '@jobtrack/shared';
import { api, type ImportCommitResponse, type ImportPreviewResponse, type ImportPreviewRow } from '../api/client.js';

const VERDICT_COLOR: Record<ImportPreviewRow['verdict'], string> = {
  new: 'green',
  duplicate: 'default',
  error: 'red',
};
const VERDICT_LABEL: Record<ImportPreviewRow['verdict'], string> = {
  new: 'New',
  duplicate: 'Duplicate — skipped',
  error: 'Error',
};

export interface ImportModalProps {
  open: boolean;
  onClose: () => void;
}

export function ImportModal({ open, onClose }: ImportModalProps) {
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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not read that file'))
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
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  const columns: ColumnsType<ImportPreviewRow> = [
    { title: 'Row', dataIndex: 'rowNumber', width: 60 },
    { title: 'Position', dataIndex: 'jobTitle', ellipsis: true },
    { title: 'Company', dataIndex: 'companyName', ellipsis: true },
    { title: 'Date', dataIndex: 'appliedOn', width: 110 },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (value: ApplicationStatus | null) => (value ? STATUS_LABELS[value] : '—'),
    },
    {
      title: 'Result',
      dataIndex: 'verdict',
      width: 200,
      render: (verdict: ImportPreviewRow['verdict'], row) => (
        <Space direction="vertical" size={0}>
          <Tag color={VERDICT_COLOR[verdict]}>{VERDICT_LABEL[verdict]}</Tag>
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
    <Modal title="Import applications" open={open} onCancel={handleClose} width={800} footer={null} destroyOnHidden>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {!preview && !result && (
          <>
            <Typography.Paragraph type="secondary">
              CSV or .xlsx with the same columns Export produces: Position, Company, Date,
              Status, Notes. Rows that exactly match an application you have already logged
              are skipped automatically.
            </Typography.Paragraph>
            <Upload.Dragger accept=".csv,.xlsx" maxCount={1} showUploadList={false} beforeUpload={beforeUpload} disabled={loading}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag a CSV or Excel file here</p>
            </Upload.Dragger>
          </>
        )}

        {error && <Alert type="error" showIcon message={error} />}

        {preview && !result && (
          <>
            <Space wrap>
              <Tag color="green">{preview.totals.new} new</Tag>
              <Tag>{preview.totals.duplicate} duplicate — will be skipped</Tag>
              {preview.totals.error > 0 && <Tag color="red">{preview.totals.error} error</Tag>}
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
              <Button onClick={reset}>Choose a different file</Button>
              <Button type="primary" loading={loading} disabled={preview.totals.new === 0} onClick={handleCommit}>
                Import {preview.totals.new} application{preview.totals.new === 1 ? '' : 's'}
              </Button>
            </Space>
          </>
        )}

        {result && (
          <Result
            status={result.failed > 0 ? 'warning' : 'success'}
            title={`Imported ${result.created} application${result.created === 1 ? '' : 's'}`}
            subTitle={
              `${result.skipped} duplicate row${result.skipped === 1 ? '' : 's'} skipped` +
              (result.failed > 0 ? `, ${result.failed} row${result.failed === 1 ? '' : 's'} failed` : '')
            }
            extra={
              <Button type="primary" onClick={handleClose}>
                Done
              </Button>
            }
          />
        )}
      </Space>
    </Modal>
  );
}
