/**
 * "Save from posting" — capture a job ad without retyping it.
 *
 * Two ways in, and the difference between them is worth being honest about in the UI
 * rather than hiding behind one box that sometimes works:
 *
 * - **A link** is fetched by the API and read for the structured job data most applicant
 *   tracking systems publish (Greenhouse, Lever, Ashby, Workday). It is the better route
 *   when it works, and it plainly does not work on LinkedIn or Indeed, which refuse
 *   automated readers. When that happens the error says so and points here, at the tab
 *   next to it.
 * - **The text** always works: paste what you copied and it is parsed locally.
 *
 * Neither one saves anything. Both hand a draft to `OpeningDrawer`, the same form used for
 * an opening typed by hand, so the last word is always the user's.
 */

import { useState } from 'react';
import { Alert, Button, Flex, Input, Modal, Space, Tabs, Typography } from 'antd';
import { LinkOutlined, FileTextOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { PostingDraft } from '@jobtrack/shared';
import { api } from '../api/index.js';
import { ApiError, type IngestResponse } from '../api/client.js';
import { DuplicateAlert } from './DuplicateAlert.js';

/** The URL route needs a server that can reach the internet; the demo has neither. */
const DEMO = import.meta.env.VITE_DEMO === 'true';

export interface PostingIngestModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the parsed draft once the user accepts it, to open the opening form. */
  onUse: (draft: PostingDraft) => void;
}

export function PostingIngestModal({ open, onClose, onUse }: PostingIngestModalProps) {
  const { t } = useTranslation('import');
  const [tab, setTab] = useState<'link' | 'text'>(DEMO ? 'text' : 'link');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResponse | null>(null);

  function reset(): void {
    setUrl('');
    setText('');
    setError(null);
    setResult(null);
    setBusy(false);
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  async function run(read: () => Promise<IngestResponse>): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await read();
      if (outcome.draft.companyName.trim() === '' || outcome.draft.jobTitle.trim() === '') {
        // A draft this thin is worse than none: it would silently create a company from a
        // page heading. Say what is missing and let the form be filled in by hand.
        setError(t('posting.thinDraftError'));
      }
      setResult(outcome);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('posting.readError'));
      // A site that refuses to be read is the expected case, not a fault — so move to the
      // tab that always works instead of leaving the user on the one that just failed.
      if (caught instanceof ApiError && caught.code === 'ingest_blocked') setTab('text');
    } finally {
      setBusy(false);
    }
  }

  const draft = result?.draft;

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={t('posting.title')}
      width={640}
      destroyOnHidden
      footer={
        <Flex justify="end" gap={8}>
          <Button onClick={handleClose}>{t('posting.cancel')}</Button>
          <Button
            type="primary"
            disabled={!draft}
            onClick={() => {
              if (!draft) return;
              onUse(draft);
              reset();
            }}
          >
            {t('posting.reviewAndSave')}
          </Button>
        </Flex>
      }
    >
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key as 'link' | 'text');
          setError(null);
          setResult(null);
        }}
        items={[
          {
            key: 'link',
            label: (
              <span>
                <LinkOutlined /> {t('posting.tabLink')}
              </span>
            ),
            disabled: DEMO,
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Input.Search
                  placeholder={t('posting.linkPlaceholder')}
                  value={url}
                  enterButton={t('posting.read')}
                  loading={busy}
                  onChange={(event) => setUrl(event.target.value)}
                  onSearch={(value) => value.trim() && void run(() => api.ingestUrl(value.trim()))}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('posting.linkHelp')}
                </Typography.Text>
              </Space>
            ),
          },
          {
            key: 'text',
            label: (
              <span>
                <FileTextOutlined /> {t('posting.tabText')}
              </span>
            ),
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Input.TextArea
                  rows={8}
                  value={text}
                  placeholder={t('posting.textPlaceholder')}
                  onChange={(event) => setText(event.target.value)}
                />
                <Flex justify="space-between" align="center" gap={12} wrap>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('posting.textHelp')}
                  </Typography.Text>
                  <Button
                    loading={busy}
                    disabled={text.trim() === ''}
                    onClick={() => void run(() => api.ingestText(text, url.trim() || undefined))}
                  >
                    {t('posting.read')}
                  </Button>
                </Flex>
              </Space>
            ),
          },
        ]}
      />

      {error && <Alert type="warning" showIcon message={error} style={{ marginTop: 12 }} />}

      {draft && (
        <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 16 }}>
          <Typography.Text strong>
            {draft.jobTitle || t('posting.untitledRole')}
            {draft.companyName ? `${t('posting.at')}${draft.companyName}` : ''}
          </Typography.Text>
          <Typography.Text type="secondary">
            {[draft.location, draft.sourceName].filter(Boolean).join(' · ') || t('posting.noLocationFound')}
          </Typography.Text>
          {/* The point of routing capture through the API: the same verdict the New
              Application form shows, at the moment you are about to save. */}
          <DuplicateAlert check={result?.duplicate} />
        </Space>
      )}
    </Modal>
  );
}
