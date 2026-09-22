/**
 * The automation rules. Both are off until switched on here, because each one writes to
 * records the user did not touch.
 *
 * The auto-ghost rule shows what it would change before and after it is switched on, and can
 * be run on the spot, so nobody has to trust an hourly job they have never seen work.
 */

import { Link } from 'react-router-dom';
import { App as AntApp, Alert, Button, Card, InputNumber, List, Space, Switch, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAutoGhostPreview, useRules, useRunAutoGhost, useSaveRules } from '../api/hooks.js';

const DEFAULT_FOLLOW_UP_DAYS = 7;
const DEFAULT_GHOST_DAYS = 45;

export function AutomationCard() {
  const { t } = useTranslation('settings');
  const { message } = AntApp.useApp();
  const { data: rules, isLoading } = useRules();
  const save = useSaveRules();
  const run = useRunAutoGhost();
  const ghostOn = rules?.autoGhostAfterDays !== null && rules?.autoGhostAfterDays !== undefined;
  const { data: preview } = useAutoGhostPreview(ghostOn);

  function saveRule(patch: Record<string, number | null>): void {
    save.mutate(patch, {
      onError: (error) => message.error(error instanceof Error ? error.message : t('automation.saveError')),
    });
  }

  async function runNow(): Promise<void> {
    try {
      const result = await run.mutateAsync();
      message.success(
        result.changed === 0 ? t('automation.runSuccessNone') : t('automation.runSuccess', { count: result.changed }),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('automation.runError'));
    }
  }

  const candidates = preview?.candidates ?? [];

  return (
    <Card title={t('automation.title')} loading={isLoading}>
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Space size={12} wrap>
            <Switch
              checked={rules?.defaultFollowUpDays !== null && rules?.defaultFollowUpDays !== undefined}
              onChange={(on) => saveRule({ defaultFollowUpDays: on ? DEFAULT_FOLLOW_UP_DAYS : null })}
            />
            <Typography.Text strong>{t('automation.followUp.toggleLabel')}</Typography.Text>
            {rules?.defaultFollowUpDays != null && (
              <Space size={6}>
                <InputNumber
                  size="small"
                  min={1}
                  max={90}
                  value={rules.defaultFollowUpDays}
                  onChange={(days) => typeof days === 'number' && saveRule({ defaultFollowUpDays: days })}
                />
                <span>{t('automation.followUp.daysAfter')}</span>
              </Space>
            )}
          </Space>
          <Typography.Text type="secondary">{t('automation.followUp.note')}</Typography.Text>
        </Space>

        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Space size={12} wrap>
            <Switch checked={ghostOn} onChange={(on) => saveRule({ autoGhostAfterDays: on ? DEFAULT_GHOST_DAYS : null })} />
            <Typography.Text strong>{t('automation.ghost.toggleLabel')}</Typography.Text>
            {ghostOn && (
              <Space size={6}>
                <span>{t('automation.ghost.after')}</span>
                <InputNumber
                  size="small"
                  min={14}
                  max={365}
                  value={rules!.autoGhostAfterDays!}
                  onChange={(days) => typeof days === 'number' && saveRule({ autoGhostAfterDays: days })}
                />
                <span>{t('automation.ghost.days')}</span>
              </Space>
            )}
          </Space>
          <Typography.Text type="secondary">{t('automation.ghost.note')}</Typography.Text>

          {ghostOn &&
            (candidates.length === 0 ? (
              <Alert type="success" showIcon message={t('automation.ghost.none')} />
            ) : (
              <Alert
                type="warning"
                showIcon
                message={t('automation.ghost.candidates', { count: candidates.length })}
                description={
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <List
                      size="small"
                      dataSource={candidates.slice(0, 5)}
                      renderItem={(application) => (
                        <List.Item>
                          <Link to={`/applications/${application.id}`}>
                            {application.jobTitle}
                            {t('automation.at')}
                            {application.company.name}
                          </Link>
                          <Typography.Text type="secondary">
                            {t('automation.ghost.silentDays', { days: application.silentDays })}
                          </Typography.Text>
                        </List.Item>
                      )}
                    />
                    {candidates.length > 5 && (
                      <Typography.Text type="secondary">
                        {t('automation.ghost.andMore', { count: candidates.length - 5 })}
                      </Typography.Text>
                    )}
                    <Button onClick={() => void runNow()} loading={run.isPending}>
                      {t('automation.ghost.runNow')}
                    </Button>
                  </Space>
                }
              />
            ))}
        </Space>
      </Space>
    </Card>
  );
}
