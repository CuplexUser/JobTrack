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
import { Trans, useTranslation } from 'react-i18next';
import { api, type LinkedInCommitResponse, type LinkedInPreviewResponse, type LinkedInPreviewRow } from '../api/index.js';

const VERDICT_COLOR: Record<LinkedInPreviewRow['verdict'], string> = {
  new: 'green',
  duplicate: 'default',
  error: 'red',
};

export interface LinkedInImportModalProps {
  open: boolean;
  onClose: () => void;
}

export function LinkedInImportModal({ open, onClose }: LinkedInImportModalProps) {
  const { t } = useTranslation('import');
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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('linkedin.readError')))
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
      setError(err instanceof Error ? err.message : t('linkedin.importFailed'));
    } finally {
      setLoading(false);
    }
  }

  const columns: ColumnsType<LinkedInPreviewRow> = [
    { title: t('linkedin.columns.name'), dataIndex: 'name', ellipsis: true },
    {
      title: t('linkedin.columns.worksAt'),
      dataIndex: 'companyName',
      ellipsis: true,
      render: (value: string | null, row) =>
        value ? (
          <Space size={4}>
            <span>{value}</span>
            {row.knownCompany && <Tag color="blue">{t('linkedin.inJobTrack')}</Tag>}
          </Space>
        ) : null,
    },
    { title: t('linkedin.columns.role'), dataIndex: 'headline', ellipsis: true },
    {
      title: t('linkedin.columns.result'),
      dataIndex: 'verdict',
      width: 140,
      render: (verdict: LinkedInPreviewRow['verdict']) => (
        <Tag color={VERDICT_COLOR[verdict]}>{t(`linkedin.verdict.${verdict}`)}</Tag>
      ),
    },
  ];

  return (
    <Modal title={t('linkedin.title')} open={open} onCancel={handleClose} width={860} footer={null} destroyOnHidden>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {error && <Alert type="error" showIcon message={error} />}

        {!preview && !result && (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              <Trans i18nKey="linkedin.description" t={t} components={{ code: <Typography.Text code /> }} />
            </Typography.Paragraph>
            <Upload.Dragger accept=".csv" maxCount={1} showUploadList={false} beforeUpload={beforeUpload} disabled={loading}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">{t('linkedin.dropzone')}</p>
              <p className="ant-upload-hint">{t('linkedin.dropzoneHint')}</p>
            </Upload.Dragger>
          </>
        )}

        {preview && !result && (
          <>
            {preview.fileErrors.map((message) => (
              <Alert key={message} type="error" showIcon message={message} />
            ))}
            <Space size={32} wrap>
              <Statistic title={t('linkedin.newPeople')} value={preview.totals.new} />
              <Statistic title={t('linkedin.atKnownCompanies')} value={preview.totals.atKnownCompanies} />
              <Statistic title={t('linkedin.alreadyAdded')} value={preview.totals.duplicate} />
              {preview.totals.error > 0 && <Statistic title={t('linkedin.skipped')} value={preview.totals.error} />}
            </Space>
            <Table<LinkedInPreviewRow>
              rowKey="rowNumber"
              size="small"
              columns={columns}
              dataSource={preview.rows}
              pagination={{ pageSize: 10, showSizeChanger: false }}
            />
            <Space>
              <Button onClick={reset}>{t('linkedin.chooseAnother')}</Button>
              <Button type="primary" loading={loading} disabled={preview.totals.new === 0} onClick={handleCommit}>
                {t('linkedin.importButton', { count: preview.totals.new })}
              </Button>
            </Space>
          </>
        )}

        {result && (
          <Result
            status="success"
            title={t('linkedin.resultTitle', { count: result.created })}
            subTitle={result.skipped > 0 ? t('linkedin.skippedSubtitle', { count: result.skipped }) : undefined}
            extra={
              <Button type="primary" onClick={handleClose}>
                {t('linkedin.done')}
              </Button>
            }
          />
        )}
      </Space>
    </Modal>
  );
}
