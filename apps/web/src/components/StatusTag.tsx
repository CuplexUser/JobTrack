import { Tag } from 'antd';
import { STATUS_COLORS, STATUS_LABELS, type ApplicationStatus } from '@jobtrack/shared';

/** One definition of how a status looks, so every view agrees. */
export function StatusTag({ status }: { status: ApplicationStatus }) {
  return <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>;
}
