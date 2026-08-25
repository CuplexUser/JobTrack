/**
 * The "have I applied here before?" panel.
 *
 * Deliberately placed *above* the form fields and shown while typing rather than on
 * submit. The point of the feature is to stop you before you fill in a whole application,
 * not to complain after you have.
 */

import { Alert, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  type DuplicateMatch,
  type DuplicateVerdict,
} from '@jobtrack/shared';
import type { DuplicateCheckResponse } from '../api/client.js';

export interface DuplicateAlertProps {
  check: DuplicateCheckResponse | undefined;
  loading?: boolean;
}

/** Alert severity follows how strongly the user should hesitate. */
const ALERT_TYPE: Record<DuplicateVerdict, 'error' | 'warning' | 'info' | 'success'> = {
  exact: 'error',
  similar: 'warning',
  company: 'info',
  none: 'success',
};

export function DuplicateAlert({ check, loading }: DuplicateAlertProps) {
  if (loading && !check) {
    return <Alert type="info" showIcon message="Checking your history…" style={{ marginBottom: 16 }} />;
  }
  if (!check) return null;

  if (check.verdict === 'none') {
    return (
      <Alert
        type="success"
        showIcon
        message="No history with this company"
        description="This looks like a company you haven't applied to before."
        style={{ marginBottom: 16 }}
      />
    );
  }

  const companyName = check.company?.name ?? 'this company';

  return (
    <Alert
      type={ALERT_TYPE[check.verdict]}
      showIcon
      style={{ marginBottom: 16 }}
      message={headline(check.verdict, companyName, check.priorCount)}
      description={
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {check.matches.length > 0 ? (
            check.matches.slice(0, 5).map((match) => <MatchRow key={match.id} match={match} />)
          ) : (
            <Typography.Text type="secondary">
              None of them were for this role, but it is worth a look before you apply again.
            </Typography.Text>
          )}
          {!check.semanticUsed && check.matches.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Matched on wording only — semantic matching is still warming up.
            </Typography.Text>
          )}
        </Space>
      }
    />
  );
}

function headline(verdict: DuplicateVerdict, company: string, priorCount: number): string {
  const times = priorCount === 1 ? 'once' : `${priorCount} times`;
  switch (verdict) {
    case 'exact':
      return `You have already applied for this exact role at ${company}`;
    case 'similar':
      return `You have applied for a very similar role at ${company}`;
    default:
      return `You have applied to ${company} ${times} before`;
  }
}

function MatchRow({ match }: { match: DuplicateMatch }) {
  const strength = Math.round(Math.max(match.titleSimilarity, match.semanticSimilarity ?? 0) * 100);

  return (
    <Space size={8} wrap>
      <Link to={`/applications/${match.id}`}>{match.jobTitle}</Link>
      <Typography.Text type="secondary">{match.appliedOn}</Typography.Text>
      <Tag color={STATUS_COLORS[match.status]}>{STATUS_LABELS[match.status]}</Tag>
      {match.matchKind === 'exact' ? (
        <Tag color="red">exact title</Tag>
      ) : (
        <Tag>{strength}% similar</Tag>
      )}
    </Space>
  );
}
