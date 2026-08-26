/**
 * Settings: which database is active, full-fidelity backup/restore, and reset/demo data.
 *
 * Connection parameters (`DB_DRIVER`, `DATABASE_URL`, …) live in `.env` only — nothing here
 * can read or edit them. All this page can do is switch which already-configured target is
 * active, export/restore a snapshot of the one that's active now, and clear or seed it.
 */

import { useEffect, useRef, useState } from 'react';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Result,
  Select,
  Space,
  Typography,
  Upload,
  type UploadProps,
} from 'antd';
import { DatabaseOutlined, ExperimentOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import { api, type BackupCommitResponse, type BackupPreviewResponse } from '../api/index.js';

/**
 * `.jtbak` backup export/restore needs `node:zlib`, which does not belong in a browser
 * bundle — see `demo-client.ts`'s `previewBackup`/`commitBackup`. The card is hidden here
 * rather than left to fail on click.
 */
const DEMO = import.meta.env.VITE_DEMO === 'true';
import { useClearDatabase, useDataStatus, useDbTargets, useSeedDatabase, useSwitchDb } from '../api/hooks.js';

const TABLE_LABELS: Record<string, string> = {
  companies: 'Companies',
  applications: 'Applications',
  tags: 'Tags',
  tagLinks: 'Tag links',
  notes: 'Notes',
  statusEvents: 'Status events',
  jobOpenings: 'Job openings',
};

function CountList({ counts }: { counts: Record<string, number> }) {
  return (
    <Descriptions size="small" column={2} bordered>
      {Object.entries(counts).map(([table, count]) => (
        <Descriptions.Item key={table} label={TABLE_LABELS[table] ?? table}>
          {count}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

function DatabaseCard() {
  const { message } = AntApp.useApp();
  const { data, isLoading } = useDbTargets();
  const switchDb = useSwitchDb();
  const [selected, setSelected] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  function confirmSwitch(target: string): void {
    Modal.confirm({
      title: `Switch to "${target}"?`,
      content:
        'The server restarts to connect to the new target. This page will reconnect and reload automatically once it is back — under `npm run dev`, that may require restarting it by hand.',
      okText: 'Switch and restart',
      onOk: async () => {
        try {
          await switchDb.mutateAsync(target);
        } catch (error) {
          message.error(error instanceof Error ? error.message : 'Could not switch database');
          return;
        }
        setReconnecting(true);
        pollRef.current = setInterval(() => {
          api
            .getDbTargets()
            .then(() => {
              if (pollRef.current) clearInterval(pollRef.current);
              window.location.reload();
            })
            .catch(() => {
              // Still restarting — keep polling.
            });
        }, 500);
      },
    });
  }

  if (reconnecting) {
    return (
      <Card title="Database">
        <Result icon={<ReloadOutlined spin />} title="Reconnecting…" subTitle="Waiting for the server to come back up." />
      </Card>
    );
  }

  const targets = data?.targets ?? [];

  return (
    <Card title="Database" loading={isLoading}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Connection settings live in <code>.env</code> and are never shown or editable here.
          {targets.length <= 1 && ' Only one target is configured, so there is nothing to switch between.'}
        </Typography.Paragraph>

        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Active target">
            <Space>
              <DatabaseOutlined />
              {data?.active} ({targets.find((t) => t.name === data?.active)?.driver})
            </Space>
          </Descriptions.Item>
        </Descriptions>

        {targets.length > 1 && (
          <Space>
            <Select
              style={{ width: 220 }}
              value={selected ?? data?.active}
              options={targets.map((t) => ({ value: t.name, label: `${t.name} (${t.driver})` }))}
              onChange={setSelected}
            />
            <Button
              type="primary"
              disabled={!selected || selected === data?.active}
              loading={switchDb.isPending}
              onClick={() => selected && confirmSwitch(selected)}
            >
              Switch
            </Button>
          </Space>
        )}
      </Space>
    </Card>
  );
}

function BackupCard() {
  const { message } = AntApp.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackupPreviewResponse | null>(null);
  const [result, setResult] = useState<BackupCommitResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  function reset(): void {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  function handleClose(): void {
    reset();
    setRestoreOpen(false);
  }

  const beforeUpload: UploadProps['beforeUpload'] = (uploaded) => {
    setFile(uploaded);
    setError(null);
    setLoading(true);
    api
      .previewBackup(uploaded)
      .then(setPreview)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not read that file'))
      .finally(() => setLoading(false));
    return false;
  };

  function handleCommit(): void {
    if (!file) return;
    Modal.confirm({
      title: 'Replace all data in the active database?',
      content: 'Every table is wiped and recreated from this backup. This cannot be undone.',
      okText: 'Restore',
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await api.commitBackup(file);
          setResult(response);
        } catch (err) {
          message.error(err instanceof Error ? err.message : 'Restore failed');
        } finally {
          setLoading(false);
        }
      },
    });
  }

  return (
    <Card title="Backup & restore">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          A full-fidelity snapshot of every table — every field, every relation, driver-agnostic.
          Not the same as the CSV/Excel export elsewhere in the app, which is a lossy report meant
          for people to read. This file is scrambled (gzip + obfuscation) so it isn't plain,
          readable JSON at rest — that's an obfuscation step, not encryption, and does not
          protect the personal data inside from anyone who actually wants it.
        </Typography.Paragraph>

        <Button
          icon={<DatabaseOutlined />}
          onClick={() => {
            window.location.href = api.backupExportUrl;
          }}
        >
          Export backup
        </Button>

        <Button onClick={() => setRestoreOpen(true)}>Restore from backup…</Button>
      </Space>

      <Modal title="Restore from backup" open={restoreOpen} onCancel={handleClose} width={600} footer={null} destroyOnHidden>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {!preview && !result && (
            <Upload.Dragger accept=".jtbak" maxCount={1} showUploadList={false} beforeUpload={beforeUpload} disabled={loading}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">Click or drag a JobTrack backup file (.jtbak) here</p>
            </Upload.Dragger>
          )}

          {error && <Alert type="error" showIcon message={error} />}

          {preview && !result && (
            <>
              <Typography.Text type="secondary">
                Backup taken {new Date(preview.exportedAt).toLocaleString()}. Restoring will replace everything
                currently in the active database with:
              </Typography.Text>
              <CountList counts={preview.counts} />
              <Space>
                <Button onClick={reset}>Choose a different file</Button>
                <Button type="primary" danger loading={loading} onClick={handleCommit}>
                  Restore
                </Button>
              </Space>
            </>
          )}

          {result && (
            <Result
              status="success"
              title="Restore complete"
              extra={
                <Space direction="vertical" style={{ width: '100%' }}>
                  <CountList counts={result.counts} />
                  <Button type="primary" onClick={() => window.location.reload()}>
                    Reload
                  </Button>
                </Space>
              }
            />
          )}
        </Space>
      </Modal>
    </Card>
  );
}

const CONFIRM_PHRASE = 'CLEAR';

function DataCard() {
  const { message } = AntApp.useApp();
  const { data: status, isLoading } = useDataStatus();
  const clearDb = useClearDatabase();
  const seedDb = useSeedDatabase();
  const [clearOpen, setClearOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  function closeClear(): void {
    setClearOpen(false);
    setConfirmText('');
  }

  function handleClear(): void {
    clearDb.mutate(undefined, {
      onSuccess: () => {
        message.success('Database cleared');
        closeClear();
      },
      onError: (error) => message.error(error instanceof Error ? error.message : 'Could not clear the database'),
    });
  }

  function handleSeed(): void {
    seedDb.mutate(undefined, {
      onSuccess: (result) =>
        message.success(`Seeded ${result.applications} applications and ${result.companies} companies`),
      onError: (error) => message.error(error instanceof Error ? error.message : 'Could not seed the database'),
    });
  }

  const counts = status?.counts ?? {};

  return (
    <Card title="Reset & demo data" loading={isLoading}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Wipe everything in the active database, or — only while it's empty — fill it with a
          realistic multi-year demo dataset to explore the app with.
        </Typography.Paragraph>

        {!status?.empty && <CountList counts={counts} />}

        <Space wrap>
          {status?.empty && (
            <Button type="primary" icon={<ExperimentOutlined />} loading={seedDb.isPending} onClick={handleSeed}>
              Seed with demo data
            </Button>
          )}
          <Button danger disabled={status?.empty} onClick={() => setClearOpen(true)}>
            Clear database…
          </Button>
        </Space>
      </Space>

      <Modal title="Clear the active database?" open={clearOpen} onCancel={closeClear} footer={null} destroyOnHidden>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="This permanently deletes every row below. There is no undo — export a backup first if you might want this data again."
          />
          <CountList counts={counts} />
          <Typography.Text>
            Type <Typography.Text code>{CONFIRM_PHRASE}</Typography.Text> to confirm.
          </Typography.Text>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            onPressEnter={() => confirmText === CONFIRM_PHRASE && handleClear()}
          />
          <Space>
            <Button onClick={closeClear}>Cancel</Button>
            <Button
              danger
              type="primary"
              disabled={confirmText !== CONFIRM_PHRASE}
              loading={clearDb.isPending}
              onClick={handleClear}
            >
              Clear database
            </Button>
          </Space>
        </Space>
      </Modal>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        Settings
      </Typography.Title>
      <DatabaseCard />
      {!DEMO && <BackupCard />}
      <DataCard />
    </Space>
  );
}
