/**
 * Settings, split into tabs so a rarely-touched section (Database) never makes a frequently
 * touched one (Profile) something to scroll past: Profile (job search profile and fit
 * scoring), Automation, Browser (what this browser remembers), Database (which target is
 * active, full-fidelity backup/restore, reset/demo data), and About. The active tab is
 * remembered per browser, same as any other view preference.
 *
 * Connection parameters (`DB_DRIVER`, `DATABASE_URL`, …) live in `.env` only — nothing here
 * can read or edit them. All the Database tab can do is switch which already-configured
 * target is active, export/restore a snapshot of the one that's active now, and clear or
 * seed it.
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
  Tabs,
  Typography,
  Upload,
  type UploadProps,
} from 'antd';
import {
  DatabaseOutlined,
  DesktopOutlined,
  EnvironmentOutlined,
  CompassOutlined,
  ExperimentOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Trans, useTranslation } from 'react-i18next';
import { api, type BackupCommitResponse, type BackupPreviewResponse } from '../api/index.js';
import { parse, usePreference } from '../preferences.js';

/**
 * `.jtbak` backup export/restore needs `node:zlib`, which does not belong in a browser
 * bundle — see `demo-client.ts`'s `previewBackup`/`commitBackup`. The card is hidden here
 * rather than left to fail on click.
 */
const DEMO = import.meta.env.VITE_DEMO === 'true';
import { useClearDatabase, useDataStatus, useDbTargets, useMeta, useSeedDatabase, useSwitchDb } from '../api/hooks.js';
import { ProfileCard } from '../components/ProfileCard.js';
import { FitWeightsCard } from '../components/FitWeightsCard.js';
import { JobSourcesCard } from '../components/JobSourcesCard.js';
import { KnownLocationsCard } from '../components/KnownLocationsCard.js';
import { AutomationCard } from '../components/AutomationCard.js';
import { RememberCard } from '../components/RememberCard.js';
import { LanguageCard } from '../components/LanguageCard.js';

function useTableLabels(): Record<string, string> {
  const { t } = useTranslation('settings');
  return {
    companies: t('table.companies'),
    applications: t('table.applications'),
    tags: t('table.tags'),
    tagLinks: t('table.tagLinks'),
    notes: t('table.notes'),
    statusEvents: t('table.statusEvents'),
    jobOpenings: t('table.jobOpenings'),
    contacts: t('table.contacts'),
    interactions: t('table.interactions'),
    contactLinks: t('table.contactLinks'),
    appSettings: t('table.appSettings'),
  };
}

function CountList({ counts }: { counts: Record<string, number> }) {
  const tableLabels = useTableLabels();
  return (
    <Descriptions size="small" column={2} bordered>
      {Object.entries(counts).map(([table, count]) => (
        <Descriptions.Item key={table} label={tableLabels[table] ?? table}>
          {count}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

function DatabaseCard() {
  const { t } = useTranslation('settings');
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
      title: t('database.confirmSwitchTitle', { target }),
      content: t('database.confirmSwitchContent'),
      okText: t('database.confirmSwitchOk'),
      onOk: async () => {
        try {
          await switchDb.mutateAsync(target);
        } catch (error) {
          message.error(error instanceof Error ? error.message : t('database.switchError'));
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
      <Card title={t('database.title')}>
        <Result icon={<ReloadOutlined spin />} title={t('database.reconnecting')} subTitle={t('database.reconnectingSubtitle')} />
      </Card>
    );
  }

  const targets = data?.targets ?? [];

  return (
    <Card title={t('database.title')} loading={isLoading}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          <Trans i18nKey="database.envNote" t={t} components={{ code: <code /> }} />
          {targets.length <= 1 && t('database.onlyOneTarget')}
        </Typography.Paragraph>

        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label={t('database.activeTarget')}>
            <Space>
              <DatabaseOutlined />
              {data?.active} ({targets.find((target) => target.name === data?.active)?.driver})
            </Space>
          </Descriptions.Item>
        </Descriptions>

        {targets.length > 1 && (
          <Space>
            <Select
              style={{ width: 220 }}
              value={selected ?? data?.active}
              options={targets.map((target) => ({ value: target.name, label: `${target.name} (${target.driver})` }))}
              onChange={setSelected}
            />
            <Button
              type="primary"
              disabled={!selected || selected === data?.active}
              loading={switchDb.isPending}
              onClick={() => selected && confirmSwitch(selected)}
            >
              {t('database.switchButton')}
            </Button>
          </Space>
        )}
      </Space>
    </Card>
  );
}

function BackupCard() {
  const { t, i18n } = useTranslation('settings');
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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('backup.readError')))
      .finally(() => setLoading(false));
    return false;
  };

  function handleCommit(): void {
    if (!file) return;
    Modal.confirm({
      title: t('backup.confirmTitle'),
      content: t('backup.confirmContent'),
      okText: t('backup.restoreAction'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await api.commitBackup(file);
          setResult(response);
        } catch (err) {
          message.error(err instanceof Error ? err.message : t('backup.restoreFailed'));
        } finally {
          setLoading(false);
        }
      },
    });
  }

  return (
    <Card title={t('backup.title')}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('backup.description')}
        </Typography.Paragraph>

        <Button
          icon={<DatabaseOutlined />}
          onClick={() => {
            window.location.href = api.backupExportUrl;
          }}
        >
          {t('backup.exportButton')}
        </Button>

        <Button onClick={() => setRestoreOpen(true)}>{t('backup.restoreButton')}</Button>
      </Space>

      <Modal title={t('backup.restoreModalTitle')} open={restoreOpen} onCancel={handleClose} width={600} footer={null} destroyOnHidden>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {!preview && !result && (
            <Upload.Dragger accept=".jtbak" maxCount={1} showUploadList={false} beforeUpload={beforeUpload} disabled={loading}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">{t('backup.dropzone')}</p>
            </Upload.Dragger>
          )}

          {error && <Alert type="error" showIcon message={error} />}

          {preview && !result && (
            <>
              <Typography.Text type="secondary">
                {t('backup.previewInfo', { date: new Date(preview.exportedAt).toLocaleString(i18n.language) })}
              </Typography.Text>
              <CountList counts={preview.counts} />
              <Space>
                <Button onClick={reset}>{t('backup.chooseAnotherFile')}</Button>
                <Button type="primary" danger loading={loading} onClick={handleCommit}>
                  {t('backup.restoreAction')}
                </Button>
              </Space>
            </>
          )}

          {result && (
            <Result
              status="success"
              title={t('backup.restoreComplete')}
              extra={
                <Space direction="vertical" style={{ width: '100%' }}>
                  <CountList counts={result.counts} />
                  <Button type="primary" onClick={() => window.location.reload()}>
                    {t('backup.reload')}
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
  const { t } = useTranslation('settings');
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
        message.success(t('data.clearSuccess'));
        closeClear();
      },
      onError: (error) => message.error(error instanceof Error ? error.message : t('data.clearError')),
    });
  }

  function handleSeed(): void {
    seedDb.mutate(undefined, {
      onSuccess: (result) =>
        message.success(t('data.seedSuccess', { applications: result.applications, companies: result.companies })),
      onError: (error) => message.error(error instanceof Error ? error.message : t('data.seedError')),
    });
  }

  const counts = status?.counts ?? {};

  return (
    <Card title={t('data.title')} loading={isLoading}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('data.description')}
        </Typography.Paragraph>

        {!status?.empty && <CountList counts={counts} />}

        <Space wrap>
          {status?.empty && (
            <Button type="primary" icon={<ExperimentOutlined />} loading={seedDb.isPending} onClick={handleSeed}>
              {t('data.seedButton')}
            </Button>
          )}
          <Button danger disabled={status?.empty} onClick={() => setClearOpen(true)}>
            {t('data.clearButton')}
          </Button>
        </Space>
      </Space>

      <Modal title={t('data.clearModalTitle')} open={clearOpen} onCancel={closeClear} footer={null} destroyOnHidden>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert type="warning" showIcon message={t('data.clearWarning')} />
          <CountList counts={counts} />
          <Typography.Text>
            <Trans
              i18nKey="data.confirmPhraseInstruction"
              t={t}
              values={{ phrase: CONFIRM_PHRASE }}
              components={{ code: <Typography.Text code /> }}
            />
          </Typography.Text>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            onPressEnter={() => confirmText === CONFIRM_PHRASE && handleClear()}
          />
          <Space>
            <Button onClick={closeClear}>{t('data.cancel')}</Button>
            <Button
              danger
              type="primary"
              disabled={confirmText !== CONFIRM_PHRASE}
              loading={clearDb.isPending}
              onClick={handleClear}
            >
              {t('data.clearConfirmButton')}
            </Button>
          </Space>
        </Space>
      </Modal>
    </Card>
  );
}

/**
 * Which build is running. Worth a card of its own rather than a line in the footer: this is
 * what a bug report has to quote, so it needs to be findable and selectable, not just a tray
 * tooltip that can't be copied.
 *
 * Package name and version are shown together because which package is serving genuinely
 * varies — `npm run dev` answers as `@jobtrack/api`, an installed tray as `jobtrack` — and
 * those version numbers move independently. A bare number invites reading it as the wrong
 * package's.
 */
function AboutCard() {
  const { t } = useTranslation('settings');
  const { data, isLoading } = useMeta();
  const build = data ? `${data.name} ${data.version}` : '';

  return (
    <Card title={t('about.title')} loading={isLoading}>
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label={t('about.running')}>
          <Space>
            <InfoCircleOutlined />
            <Typography.Text copyable={{ text: build }}>
              <code>{data?.name}</code> {data?.version}
            </Typography.Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('about.databaseDriver')}>{data?.driver}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

const SETTINGS_TABS = ['profile', 'sources', 'locations', 'automation', 'browser', 'database', 'about'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const [tab, setTab] = usePreference<SettingsTab>('view', 'settings.tab', 'profile', parse.oneOf(SETTINGS_TABS));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {t('title')}
      </Typography.Title>
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as SettingsTab)}
        items={[
          {
            key: 'profile',
            label: (
              <span>
                <UserOutlined /> {t('tabs.profile')}
              </span>
            ),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <ProfileCard />
                <FitWeightsCard />
              </Space>
            ),
          },
          {
            key: 'sources',
            label: (
              <span>
                <CompassOutlined /> {t('tabs.sources')}
              </span>
            ),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <JobSourcesCard kind="platforms" />
                <JobSourcesCard kind="apis" />
              </Space>
            ),
          },
          {
            key: 'locations',
            label: (
              <span>
                <EnvironmentOutlined /> {t('tabs.locations')}
              </span>
            ),
            children: <KnownLocationsCard />,
          },
          {
            key: 'automation',
            label: (
              <span>
                <RobotOutlined /> {t('tabs.automation')}
              </span>
            ),
            children: <AutomationCard />,
          },
          {
            key: 'browser',
            label: (
              <span>
                <DesktopOutlined /> {t('tabs.browser')}
              </span>
            ),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <LanguageCard />
                <RememberCard />
              </Space>
            ),
          },
          {
            key: 'database',
            label: (
              <span>
                <DatabaseOutlined /> {t('tabs.database')}
              </span>
            ),
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <DatabaseCard />
                {!DEMO && <BackupCard />}
                <DataCard />
              </Space>
            ),
          },
          {
            key: 'about',
            label: (
              <span>
                <InfoCircleOutlined /> {t('tabs.about')}
              </span>
            ),
            children: <AboutCard />,
          },
        ]}
      />
    </Space>
  );
}
