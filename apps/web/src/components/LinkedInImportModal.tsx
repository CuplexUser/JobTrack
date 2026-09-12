/**
 * Importing a LinkedIn network from the user's own data export.
 *
 * Same two steps as the applications import: choosing the file previews what would happen,
 * and nothing is written until the user confirms. The preview counts how many new people
 * work at companies already in JobTrack, because those are the connections that matter for
 * a job search; the rest are kept so they turn up once one of their employers does.
 */

import { useState } from 'react';
import { Alert, Button, Modal, Result, Space, Statistic, Table, Tag, Typography, Upload, type UploadProps } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useQueryClient } from '@tanstack/react-query';
import { api, type LinkedInCommitResponse, type LinkedInPreviewResponse, type LinkedInPreviewRow } from '../api/index.js';

const VERDICT: Record<LinkedInPreviewRow['verdict'], { color: string; label: string }> = {
  new: { color: 'green', label: 'New' },
  duplicate: { color: 'default', label: 'Already added' },
  error: { color: 'red', label: 'Skipped' },
};

export interface LinkedInImportModalProps {
  open: boolean;
  onClose: () => void;
}

export function LinkedInImportModal({ open, onClose }: LinkedInImportModalProps) {
  const queryClient = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<LinkedInPreviewResponse | null>(null);
  const [result, setResult] = useState<LinkedInCommitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setCsv(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    setError(null);
    setLoading(true);
    void file
      .text()
      .then(async (text) => {
        setCsv(text);
        setPreview(await api.previewLinkedInImport(text));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not read that file'))
      .finally(() => setLoading(false));
    return false; // Ant Design's own upload machinery never runs; the calls above own it.
  };

  async function handleCommit(): Promise<void> {
    if (!csv) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.commitLinkedInImport(csv);
      setResult(response);
      if (response.created > 0) {
        for (const key of ['contacts', 'contact', 'duplicates', 'search', 'dashboard']) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  const columns: ColumnsType<LinkedInPreviewRow> = [
    { title: 'Name', dataIndex: 'name', ellipsis: true },
    {
      title: 'Works at',
      dataIndex: 'companyName',
      ellipsis: true,
      render: (value: string | null, row) =>
        value ? (
          <Space size={4}>
            <span>{value}</span>
            {row.knownCompany && <Tag color="blue">in JobTrack</Tag>}
          </Space>
        ) : null,
    },
    { title: 'Role', dataIndex: 'headline', ellipsis: true },
    {
      title: 'Result',
      dataIndex: 'verdict',
      width: 140,
      render: (verdict: LinkedInPreviewRow['verdict']) => <Tag color={VERDICT[verdict].color}>{VERDICT[verdict].label}</Tag>,
    },
  ];

  return (
    <Modal title="Import LinkedIn connections" open={open} onCancel={handleClose} width={860} footer={null} destroyOnHidden>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {error && <Alert type="error" showIcon message={error} />}

        {!preview && !result && (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              LinkedIn lets you download your own data: open LinkedIn, go to Settings, then Data
              privacy, then Get a copy of your data, and choose Connections. The file you get by
              email is <Typography.Text code>Connections.csv</Typography.Text>. People already in
              JobTrack are recognized and skipped, so importing a newer export later is safe.
            </Typography.Paragraph>
            <Upload.Dragger accept=".csv" maxCount={1} showUploadList={false} beforeUpload={beforeUpload} disabled={loading}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drop Connections.csv here</p>
              <p className="ant-upload-hint">Nothing is saved until you confirm</p>
            </Upload.Dragger>
          </>
        )}

        {preview && !result && (
          <>
            {preview.fileErrors.map((message) => (
              <Alert key={message} type="error" showIcon message={message} />
            ))}
            <Space size={32} wrap>
              <Statistic title="New people" value={preview.totals.new} />
              <Statistic title="At companies in JobTrack" value={preview.totals.atKnownCompanies} />
              <Statistic title="Already added" value={preview.totals.duplicate} />
              {preview.totals.error > 0 && <Statistic title="Skipped" value={preview.totals.error} />}
            </Space>
            <Table<LinkedInPreviewRow>
              rowKey="rowNumber"
              size="small"
              columns={columns}
              dataSource={preview.rows}
              pagination={{ pageSize: 10, showSizeChanger: false }}
            />
            <Space>
              <Button onClick={reset}>Choose a different file</Button>
              <Button type="primary" loading={loading} disabled={preview.totals.new === 0} onClick={handleCommit}>
                Import {preview.totals.new} {preview.totals.new === 1 ? 'person' : 'people'}
              </Button>
            </Space>
          </>
        )}

        {result && (
          <Result
            status="success"
            title={`Imported ${result.created} ${result.created === 1 ? 'person' : 'people'}`}
            subTitle={result.skipped > 0 ? `${result.skipped} skipped because they were already added or had no name.` : undefined}
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
