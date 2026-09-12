/**
 * The automation rules. Both are off until switched on here, because each one writes to
 * records the user did not touch.
 *
 * The auto-ghost rule shows what it would change before and after it is switched on, and can
 * be run on the spot, so nobody has to trust an hourly job they have never seen work.
 */

import { Link } from 'react-router-dom';
import { App as AntApp, Alert, Button, Card, InputNumber, List, Space, Switch, Typography } from 'antd';
import { useAutoGhostPreview, useRules, useRunAutoGhost, useSaveRules } from '../api/hooks.js';

const DEFAULT_FOLLOW_UP_DAYS = 7;
const DEFAULT_GHOST_DAYS = 45;

export function AutomationCard() {
  const { message } = AntApp.useApp();
  const { data: rules, isLoading } = useRules();
  const save = useSaveRules();
  const run = useRunAutoGhost();
  const ghostOn = rules?.autoGhostAfterDays !== null && rules?.autoGhostAfterDays !== undefined;
  const { data: preview } = useAutoGhostPreview(ghostOn);

  function saveRule(patch: Record<string, number | null>): void {
    save.mutate(patch, {
      onError: (error) => message.error(error instanceof Error ? error.message : 'Could not save'),
    });
  }

  async function runNow(): Promise<void> {
    try {
      const result = await run.mutateAsync();
      message.success(
        result.changed === 0
          ? 'Nothing to change'
          : `Marked ${result.changed} application${result.changed === 1 ? '' : 's'} ghosted`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not run the rule');
    }
  }

  const candidates = preview?.candidates ?? [];

  return (
    <Card title="Automation" loading={isLoading}>
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Space size={12} wrap>
            <Switch
              checked={rules?.defaultFollowUpDays !== null && rules?.defaultFollowUpDays !== undefined}
              onChange={(on) => saveRule({ defaultFollowUpDays: on ? DEFAULT_FOLLOW_UP_DAYS : null })}
            />
            <Typography.Text strong>Give new applications a follow-up date</Typography.Text>
            {rules?.defaultFollowUpDays != null && (
              <Space size={6}>
                <InputNumber
                  size="small"
                  min={1}
                  max={90}
                  value={rules.defaultFollowUpDays}
                  onChange={(days) => typeof days === 'number' && saveRule({ defaultFollowUpDays: days })}
                />
                <span>days after applying</span>
              </Space>
            )}
          </Space>
          <Typography.Text type="secondary">
            Only when you leave the date blank, and never a date that has already passed, so importing old
            applications does not flood your follow-ups.
          </Typography.Text>
        </Space>

        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Space size={12} wrap>
            <Switch checked={ghostOn} onChange={(on) => saveRule({ autoGhostAfterDays: on ? DEFAULT_GHOST_DAYS : null })} />
            <Typography.Text strong>Mark silent applications as ghosted</Typography.Text>
            {ghostOn && (
              <Space size={6}>
                <span>after</span>
                <InputNumber
                  size="small"
                  min={14}
                  max={365}
                  value={rules!.autoGhostAfterDays!}
                  onChange={(days) => typeof days === 'number' && saveRule({ autoGhostAfterDays: days })}
                />
                <span>days</span>
              </Space>
            )}
          </Space>
          <Typography.Text type="secondary">
            Applies to applications still at Applied or Screening where nothing has happened in that long:
            no status change, and no follow-up date in that time. A follow-up planned for later keeps an
            application safe. It runs every hour while JobTrack is running. Each change is written to
            the application&apos;s status history with a note saying why, so it is easy to undo.
          </Typography.Text>

          {ghostOn &&
            (candidates.length === 0 ? (
              <Alert type="success" showIcon message="Nothing would be marked ghosted right now." />
            ) : (
              <Alert
                type="warning"
                showIcon
                message={`${candidates.length} application${candidates.length === 1 ? '' : 's'} would be marked ghosted on the next run`}
                description={
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <List
                      size="small"
                      dataSource={candidates.slice(0, 5)}
                      renderItem={(application) => (
                        <List.Item>
                          <Link to={`/applications/${application.id}`}>
                            {application.jobTitle} at {application.company.name}
                          </Link>
                          <Typography.Text type="secondary">silent {application.silentDays} days</Typography.Text>
                        </List.Item>
                      )}
                    />
                    {candidates.length > 5 && (
                      <Typography.Text type="secondary">and {candidates.length - 5} more</Typography.Text>
                    )}
                    <Button onClick={() => void runNow()} loading={run.isPending}>
                      Run now
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
