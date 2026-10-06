import { Tag } from 'antd';
import { STATUS_COLORS, type ApplicationStatus } from '@jobtrack/shared';
import { useStatusLabel } from '../hooks/useLabels.js';

/** One definition of how a status looks, so every view agrees. */
export function StatusTag({ status }: { status: ApplicationStatus }) {
  const statusLabel = useStatusLabel();
  return <Tag color={STATUS_COLORS[status]}>{statusLabel(status)}</Tag>;
}
