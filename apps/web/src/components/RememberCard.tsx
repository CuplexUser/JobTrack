/**
 * Settings > Remembered in this browser: how long the web UI keeps sort orders and filters,
 * and a way to forget them. The storage itself is in `preferences.ts`.
 */

import { useState } from 'react';
import { App as AntApp, Button, Card, Descriptions, Flex, Segmented, Typography } from 'antd';
import {
  DEFAULT_REMEMBER_MODES,
  countPreferences,
  forgetPreferences,
  loadRememberModes,
  setRememberMode,
  type PreferenceGroup,
  type RememberMode,
} from '../preferences.js';

const GROUPS: { group: PreferenceGroup; label: string; covers: string }[] = [
  {
    group: 'view',
    label: 'Sorting and layout',
    covers: 'Sort order, rows per page, the chart grouping on Statistics and the tab under Needs attention.',
  },
  {
    group: 'filters',
    label: 'Searches and filters',
    covers: 'Search text, status, tag and location filters, date ranges, and Active or Archived openings.',
  },
];

const MODE_OPTIONS: { label: string; value: RememberMode }[] = [
  { label: 'Always', value: 'always' },
  { label: 'Until the tab closes', value: 'session' },
  { label: 'Never', value: 'off' },
];

export function RememberCard() {
  const { message } = AntApp.useApp();
  const [modes, setModes] = useState(loadRememberModes);
  const [count, setCount] = useState(countPreferences);

  function change(group: PreferenceGroup, mode: RememberMode): void {
    setRememberMode(group, mode);
    setModes(loadRememberModes());
    setCount(countPreferences());
  }

  function forget(): void {
    forgetPreferences();
    setCount(countPreferences());
    message.success('Forgotten. Pages start from their defaults.');
  }

  return (
    <Card
      title="Remembered in this browser"
      extra={
        <Button size="small" disabled={count === 0} onClick={forget}>
          Forget now
        </Button>
      }
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          Pages keep how you left them when you come back. This is stored in this browser only, not
          in the database, so another browser or computer keeps its own.
        </Typography.Text>
        <Descriptions size="small" column={1} bordered>
          {GROUPS.map(({ group, label, covers }) => (
            <Descriptions.Item
              key={group}
              label={
                <Flex vertical>
                  <span>{label}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                    {covers}
                  </Typography.Text>
                </Flex>
              }
            >
              <Segmented<RememberMode>
                value={modes[group]}
                onChange={(mode) => change(group, mode)}
                options={MODE_OPTIONS.map((option) => ({
                  ...option,
                  label: option.value === DEFAULT_REMEMBER_MODES[group] ? `${option.label} (default)` : option.label,
                }))}
              />
            </Descriptions.Item>
          ))}
        </Descriptions>
      </Flex>
    </Card>
  );
}
