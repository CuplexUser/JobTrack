/**
 * Automatic backups: where they go, when, how long they are kept, and how they are encrypted.
 *
 * Edited as a draft and saved with one button rather than field by field, since a folder path
 * half-typed is not something to save. "Test" checks the draft as it stands, so a wrong
 * folder or a missing YubiKey plugin shows up before it is saved, not at 02:00.
 *
 * The secret half of a generated key pair is shown once and never stored: JobTrack only keeps
 * the public key, so nothing on this machine can decrypt the backups it writes.
 */

import { useMemo, useState } from 'react';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  List,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  ExportOutlined,
  KeyOutlined,
  LockOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ageRecipientProblem, type BackupConfig, type BackupRecipient, type BackupTestResult, type GeneratedBackupKey } from '@jobtrack/shared';
import { api } from '../api/index.js';
import { useAutoBackup, useAutoBackupFiles, useRunAutoBackup, useSaveAutoBackup, useSetBackupPassphrase } from '../api/hooks.js';

/** The README section on encryption and keys, for the full story behind the in-app summary. */
const KEYS_DOCS_URL = 'https://github.com/CuplexUser/JobTrack#encryption';
const AGE_URL = 'https://age-encryption.org';

/** 2026-01-04 was a Sunday, so day `n` of the week is the 4th plus `n`. */
function weekdayNames(language: string): string[] {
  const format = new Intl.DateTimeFormat(language, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(2026, 0, 4 + day)));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function AutoBackupCard() {
  const { t, i18n } = useTranslation('settings');
  const { message } = AntApp.useApp();
  const { data: status, isLoading } = useAutoBackup();
  const save = useSaveAutoBackup();
  const setPassphrase = useSetBackupPassphrase();
  const run = useRunAutoBackup();

  /** Unsaved edits. Null means "what is saved", so the form follows the server until touched. */
  const [edits, setEdits] = useState<BackupConfig | null>(null);
  const [testResult, setTestResult] = useState<BackupTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [newRecipient, setNewRecipient] = useState<BackupRecipient>({ label: '', recipient: '' });
  const [generated, setGenerated] = useState<GeneratedBackupKey | null>(null);
  const [savedSecret, setSavedSecret] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [keysHelpOpen, setKeysHelpOpen] = useState(false);
  const files = useAutoBackupFiles(showFiles && Boolean(status?.config.destination.path));

  const weekdays = useMemo(() => weekdayNames(i18n.language), [i18n.language]);
  const draft = edits ?? status?.config ?? null;
  const dirty = edits !== null && status !== undefined && JSON.stringify(edits) !== JSON.stringify(status.config);

  if (!draft || !status) return <Card title={t('autoBackup.title')} loading={isLoading} />;

  // Checked as it is typed or pasted, so a made-up or cut-off key never reaches the list.
  const typedKey = newRecipient.recipient.trim();
  const keyProblem = typedKey === '' ? null : ageRecipientProblem(typedKey);
  const keyIsDuplicate =
    keyProblem === null && draft.encryption.recipients.some((entry) => entry.recipient === typedKey.toLowerCase());
  const keyError = keyProblem ? t(`autoBackup.keys.problem.${keyProblem}`) : keyIsDuplicate ? t('autoBackup.keys.duplicate') : null;
  const canAddKey = typedKey !== '' && keyError === null;

  function update(patch: Partial<BackupConfig>): void {
    setEdits({ ...draft!, ...patch });
    setTestResult(null);
  }

  async function handleSave(): Promise<void> {
    try {
      await save.mutateAsync(draft!);
      setEdits(null);
      message.success(t('autoBackup.saved'));
    } catch (error) {
      message.error(errorMessage(error, t('autoBackup.saveError')));
    }
  }

  async function handleTest(): Promise<void> {
    setTesting(true);
    try {
      setTestResult(await api.testAutoBackup({ destination: draft!.destination, encryption: draft!.encryption }));
    } catch (error) {
      setTestResult({ ok: false, problems: [errorMessage(error, t('autoBackup.testError'))] });
    } finally {
      setTesting(false);
    }
  }

  async function handleRun(): Promise<void> {
    try {
      const result = await run.mutateAsync();
      message.success(t('autoBackup.runSuccess', { file: result.file }));
      if (showFiles) void files.refetch();
    } catch (error) {
      message.error(errorMessage(error, t('autoBackup.runError')));
    }
  }

  async function handleSavePassphrase(value: string | null): Promise<void> {
    try {
      await setPassphrase.mutateAsync(value);
      setPassphraseInput('');
      message.success(value === null ? t('autoBackup.passphrase.cleared') : t('autoBackup.passphrase.saved'));
    } catch (error) {
      message.error(errorMessage(error, t('autoBackup.saveError')));
    }
  }

  async function handleGenerate(): Promise<void> {
    try {
      setSavedSecret(false);
      setGenerated(await api.generateBackupKey());
    } catch (error) {
      message.error(errorMessage(error, t('autoBackup.keys.generateError')));
    }
  }

  function addRecipient(entry: BackupRecipient): void {
    const recipient = entry.recipient.trim().toLowerCase();
    if (recipient === '' || ageRecipientProblem(recipient)) return;
    if (draft!.encryption.recipients.some((existing) => existing.recipient === recipient)) {
      message.warning(t('autoBackup.keys.duplicate'));
      return;
    }
    update({ encryption: { ...draft!.encryption, recipients: [...draft!.encryption.recipients, { label: entry.label.trim(), recipient }] } });
  }

  function addNewRecipient(): void {
    if (!canAddKey) return;
    addRecipient(newRecipient);
    setNewRecipient({ label: '', recipient: '' });
  }

  function removeRecipient(recipient: string): void {
    update({
      encryption: { ...draft!.encryption, recipients: draft!.encryption.recipients.filter((entry) => entry.recipient !== recipient) },
    });
  }

  const { state } = status;
  const { schedule, retention, encryption } = draft;
  const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : t('autoBackup.never'));

  return (
    <Card title={t('autoBackup.title')}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('autoBackup.description')}
        </Typography.Paragraph>

        <Space size={12}>
          <Switch checked={draft.enabled} onChange={(enabled) => update({ enabled })} />
          <Typography.Text strong>{t('autoBackup.enabled')}</Typography.Text>
        </Space>

        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label={t('autoBackup.status.lastBackup')}>
            {formatDate(state.lastSuccessAt)}
            {state.lastFile && (
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                {state.lastFile}
              </Typography.Text>
            )}
          </Descriptions.Item>
          {state.lastSkippedAt && (
            <Descriptions.Item label={t('autoBackup.status.lastSkipped')}>{formatDate(state.lastSkippedAt)}</Descriptions.Item>
          )}
          <Descriptions.Item label={t('autoBackup.status.nextBackup')}>
            {status.nextRunAt ? formatDate(status.nextRunAt) : t('autoBackup.status.off')}
          </Descriptions.Item>
        </Descriptions>

        {state.lastError && (
          <Alert type="error" showIcon message={t('autoBackup.status.failed', { date: formatDate(state.lastRunAt) })} description={state.lastError} />
        )}

        <Divider titlePlacement="start" plain style={{ margin: 0 }}>
          {t('autoBackup.destination.heading')}
        </Divider>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Input
            value={draft.destination.path}
            placeholder={t('autoBackup.destination.placeholder')}
            onChange={(e) => update({ destination: { ...draft.destination, path: e.target.value } })}
          />
          <Typography.Text type="secondary">{t('autoBackup.destination.hint')}</Typography.Text>
        </Space>

        <Divider titlePlacement="start" plain style={{ margin: 0 }}>
          {t('autoBackup.schedule.heading')}
        </Divider>
        <Space size={12} wrap>
          <Select
            style={{ width: 160 }}
            value={schedule.frequency}
            onChange={(frequency) => update({ schedule: { ...schedule, frequency } })}
            options={[
              { value: 'hourly', label: t('autoBackup.schedule.hourly') },
              { value: 'daily', label: t('autoBackup.schedule.daily') },
              { value: 'weekly', label: t('autoBackup.schedule.weekly') },
            ]}
          />
          {schedule.frequency === 'hourly' ? (
            <Space size={6}>
              <span>{t('autoBackup.schedule.every')}</span>
              <InputNumber
                min={1}
                max={24}
                value={schedule.everyHours}
                onChange={(hours) => typeof hours === 'number' && update({ schedule: { ...schedule, everyHours: hours } })}
              />
              <span>{t('autoBackup.schedule.hours')}</span>
            </Space>
          ) : (
            <Space size={6}>
              <span>{t('autoBackup.schedule.at')}</span>
              <Input
                type="time"
                style={{ width: 120 }}
                value={schedule.time}
                onChange={(e) => e.target.value && update({ schedule: { ...schedule, time: e.target.value } })}
              />
            </Space>
          )}
        </Space>
        {schedule.frequency === 'weekly' && (
          <Checkbox.Group
            value={schedule.weekdays}
            onChange={(days) => days.length > 0 && update({ schedule: { ...schedule, weekdays: [...(days as number[])].sort((a, b) => a - b) } })}
            options={[1, 2, 3, 4, 5, 6, 0].map((day) => ({ value: day, label: weekdays[day] }))}
          />
        )}
        <Space direction="vertical" size={2}>
          <Checkbox checked={draft.skipUnchanged} onChange={(e) => update({ skipUnchanged: e.target.checked })}>
            {t('autoBackup.schedule.skipUnchanged')}
          </Checkbox>
          <Typography.Text type="secondary">{t('autoBackup.schedule.catchUp')}</Typography.Text>
        </Space>

        <Divider titlePlacement="start" plain style={{ margin: 0 }}>
          {t('autoBackup.retention.heading')}
        </Divider>
        <Space direction="vertical" size={8}>
          <Space size={8} wrap>
            <Checkbox
              checked={retention.keepLast !== null}
              onChange={(e) => update({ retention: { ...retention, keepLast: e.target.checked ? 14 : null } })}
            >
              {t('autoBackup.retention.keepLast')}
            </Checkbox>
            {retention.keepLast !== null && (
              <InputNumber
                size="small"
                min={1}
                max={1000}
                value={retention.keepLast}
                onChange={(n) => typeof n === 'number' && update({ retention: { ...retention, keepLast: n } })}
              />
            )}
          </Space>
          <Space size={8} wrap>
            <Checkbox
              checked={retention.maxAgeDays !== null}
              onChange={(e) => update({ retention: { ...retention, maxAgeDays: e.target.checked ? 90 : null } })}
            >
              {t('autoBackup.retention.maxAge')}
            </Checkbox>
            {retention.maxAgeDays !== null && (
              <Space size={6}>
                <InputNumber
                  size="small"
                  min={1}
                  max={3650}
                  value={retention.maxAgeDays}
                  onChange={(n) => typeof n === 'number' && update({ retention: { ...retention, maxAgeDays: n } })}
                />
                <span>{t('autoBackup.retention.days')}</span>
              </Space>
            )}
          </Space>
          <Typography.Text type="secondary">{t('autoBackup.retention.note')}</Typography.Text>
        </Space>

        <Divider titlePlacement="start" plain style={{ margin: 0 }}>
          {t('autoBackup.encryption.heading')}
        </Divider>
        <Radio.Group
          value={encryption.mode}
          onChange={(e) => update({ encryption: { ...encryption, mode: e.target.value } })}
          optionType="button"
          options={[
            { value: 'none', label: t('autoBackup.encryption.none') },
            { value: 'passphrase', label: t('autoBackup.encryption.passphrase') },
            { value: 'recipients', label: t('autoBackup.encryption.keys') },
          ]}
        />

        {encryption.mode === 'none' && <Typography.Text type="secondary">{t('autoBackup.encryption.noneNote')}</Typography.Text>}

        {encryption.mode === 'passphrase' && (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Alert type="info" showIcon message={t('autoBackup.passphrase.note')} />
            {status.hasPassphrase && (
              <Space>
                <Tag icon={<LockOutlined />} color="green">
                  {t('autoBackup.passphrase.isSaved')}
                </Tag>
                <Button size="small" onClick={() => void handleSavePassphrase(null)}>
                  {t('autoBackup.passphrase.clear')}
                </Button>
              </Space>
            )}
            <Space.Compact style={{ width: '100%', maxWidth: 480 }}>
              <Input.Password
                value={passphraseInput}
                placeholder={status.hasPassphrase ? t('autoBackup.passphrase.replacePlaceholder') : t('autoBackup.passphrase.placeholder')}
                onChange={(e) => setPassphraseInput(e.target.value)}
              />
              <Button
                disabled={passphraseInput.length < 8}
                loading={setPassphrase.isPending}
                onClick={() => void handleSavePassphrase(passphraseInput)}
              >
                {t('autoBackup.passphrase.save')}
              </Button>
            </Space.Compact>
          </Space>
        )}

        {encryption.mode === 'recipients' && (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              {t('autoBackup.keys.note')}{' '}
              <Typography.Link onClick={() => setKeysHelpOpen(true)}>
                <QuestionCircleOutlined /> {t('autoBackup.keys.howKeysWork')}
              </Typography.Link>
            </Typography.Text>
            <List
              size="small"
              bordered
              locale={{ emptyText: t('autoBackup.keys.empty') }}
              dataSource={encryption.recipients}
              renderItem={(entry) => (
                <List.Item
                  actions={[
                    <Button
                      key="remove"
                      size="small"
                      type="text"
                      icon={<DeleteOutlined />}
                      aria-label={t('autoBackup.keys.remove')}
                      onClick={() => removeRecipient(entry.recipient)}
                    />,
                  ]}
                >
                  <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
                    <Space size={6}>
                      <KeyOutlined />
                      <Typography.Text strong>{entry.label || t('autoBackup.keys.unnamed')}</Typography.Text>
                      {entry.recipient.startsWith('age1yubikey1') && <Tag>YubiKey</Tag>}
                    </Space>
                    <Typography.Text type="secondary" ellipsis style={{ maxWidth: 520 }} copyable={{ text: entry.recipient }}>
                      {entry.recipient}
                    </Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
            {encryption.recipients.length === 1 && (
              <Alert
                type="warning"
                showIcon
                message={t('autoBackup.keys.addSecond')}
                action={
                  <Button size="small" type="link" onClick={() => setKeysHelpOpen(true)}>
                    {t('autoBackup.keys.learnMore')}
                  </Button>
                }
              />
            )}
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  style={{ width: '30%' }}
                  value={newRecipient.label}
                  placeholder={t('autoBackup.keys.labelPlaceholder')}
                  onChange={(e) => setNewRecipient({ ...newRecipient, label: e.target.value })}
                />
                <Input
                  value={newRecipient.recipient}
                  placeholder="age1…"
                  status={keyError ? 'error' : undefined}
                  aria-invalid={keyError !== null}
                  aria-describedby="new-key-error"
                  onChange={(e) => setNewRecipient({ ...newRecipient, recipient: e.target.value })}
                  onPressEnter={addNewRecipient}
                />
                <Button disabled={!canAddKey} onClick={addNewRecipient}>
                  {t('autoBackup.keys.add')}
                </Button>
              </Space.Compact>
              {keyError && (
                <Typography.Text id="new-key-error" type="danger">
                  {keyError}
                </Typography.Text>
              )}
            </Space>
            <Space wrap>
              <Button icon={<KeyOutlined />} onClick={() => void handleGenerate()}>
                {t('autoBackup.keys.generate')}
              </Button>
            </Space>
            <Typography.Text type="secondary">{t('autoBackup.keys.hardwareHint')}</Typography.Text>
          </Space>
        )}

        {testResult &&
          (testResult.ok ? (
            <Alert type="success" showIcon icon={<CheckCircleOutlined />} message={t('autoBackup.testOk')} />
          ) : (
            <Alert
              type="error"
              showIcon
              message={t('autoBackup.testProblems')}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {testResult.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              }
            />
          ))}

        <Space wrap>
          <Button type="primary" disabled={!dirty} loading={save.isPending} onClick={() => void handleSave()}>
            {t('autoBackup.save')}
          </Button>
          <Button disabled={!dirty && !draft.destination.path} loading={testing} onClick={() => void handleTest()}>
            {t('autoBackup.test')}
          </Button>
          <Button
            icon={<CloudUploadOutlined />}
            disabled={dirty || !status.config.destination.path}
            loading={run.isPending}
            onClick={() => void handleRun()}
          >
            {t('autoBackup.runNow')}
          </Button>
          <Button type="link" disabled={!status.config.destination.path} onClick={() => setShowFiles((shown) => !shown)}>
            {showFiles ? t('autoBackup.files.hide') : t('autoBackup.files.show')}
          </Button>
        </Space>
        {dirty && <Typography.Text type="secondary">{t('autoBackup.unsaved')}</Typography.Text>}

        {showFiles &&
          (files.error ? (
            <Alert type="error" showIcon message={errorMessage(files.error, t('autoBackup.files.error'))} />
          ) : (
            <Table
              size="small"
              rowKey="name"
              loading={files.isLoading}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              dataSource={files.data ?? []}
              locale={{ emptyText: t('autoBackup.files.empty') }}
              columns={[
                {
                  title: t('autoBackup.files.name'),
                  dataIndex: 'name',
                  render: (name: string, file) => (
                    <Space size={6}>
                      {file.encrypted && <LockOutlined aria-label={t('autoBackup.files.encrypted')} />}
                      <Typography.Text>{name}</Typography.Text>
                    </Space>
                  ),
                },
                { title: t('autoBackup.files.size'), dataIndex: 'size', width: 100, render: (size: number) => formatSize(size) },
                {
                  title: t('autoBackup.files.modified'),
                  dataIndex: 'modifiedAt',
                  width: 200,
                  render: (iso: string) => new Date(iso).toLocaleString(i18n.language),
                },
              ]}
            />
          ))}
      </Space>

      <Modal
        title={t('autoBackup.keys.generatedTitle')}
        open={generated !== null}
        onCancel={() => setGenerated(null)}
        okText={t('autoBackup.keys.useKey')}
        okButtonProps={{ disabled: !savedSecret }}
        onOk={() => {
          if (generated) addRecipient({ label: t('autoBackup.keys.generatedLabel'), recipient: generated.recipient });
          setGenerated(null);
        }}
        destroyOnHidden
      >
        {generated && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert type="warning" showIcon message={t('autoBackup.keys.secretWarning')} />
            <Typography.Text strong>{t('autoBackup.keys.secretLabel')}</Typography.Text>
            <Typography.Paragraph code copyable style={{ wordBreak: 'break-all', marginBottom: 0 }}>
              {generated.identity}
            </Typography.Paragraph>
            <Button
              onClick={() =>
                downloadText(
                  'jobtrack-backup-key.txt',
                  `# JobTrack backup key, created ${new Date().toISOString()}\n# public key: ${generated.recipient}\n${generated.identity}\n`,
                )
              }
            >
              {t('autoBackup.keys.download')}
            </Button>
            <Typography.Text type="secondary">{t('autoBackup.keys.publicLabel', { recipient: generated.recipient })}</Typography.Text>
            <Checkbox checked={savedSecret} onChange={(e) => setSavedSecret(e.target.checked)}>
              {t('autoBackup.keys.confirmSaved')}
            </Checkbox>
          </Space>
        )}
      </Modal>

      <Modal
        title={t('autoBackup.keysHelp.title')}
        open={keysHelpOpen}
        onCancel={() => setKeysHelpOpen(false)}
        footer={<Button onClick={() => setKeysHelpOpen(false)}>{t('autoBackup.keysHelp.close')}</Button>}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {(['anyOne', 'whySecond', 'goodPair', 'changes', 'publicOnly'] as const).map((part) => (
            <div key={part}>
              <Typography.Text strong>{t(`autoBackup.keysHelp.${part}Title`)}</Typography.Text>
              <Typography.Paragraph style={{ marginBottom: 0 }}>{t(`autoBackup.keysHelp.${part}`)}</Typography.Paragraph>
            </div>
          ))}
          <Space direction="vertical" size={2}>
            <Typography.Link href={KEYS_DOCS_URL} target="_blank" rel="noreferrer">
              <ExportOutlined /> {t('autoBackup.keysHelp.docsLink')}
            </Typography.Link>
            <Typography.Link href={AGE_URL} target="_blank" rel="noreferrer">
              <ExportOutlined /> {t('autoBackup.keysHelp.ageLink')}
            </Typography.Link>
          </Space>
        </Space>
      </Modal>
    </Card>
  );
}
