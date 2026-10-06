import { useTranslation } from 'react-i18next';
import type { ApplicationStatus, Channel, ContactRole, Relationship } from '@jobtrack/shared';

/**
 * Translated names for the shared vocabulary.
 *
 * The `*_LABELS` maps in `@jobtrack/shared` stay English, since export, import and the MCP
 * depend on them; the web UI reads these instead. Work modes are left out on purpose:
 * "Remote" and "Hybrid" are what Swedish job ads say too.
 */
export function useStatusLabel(): (status: ApplicationStatus) => string {
  const { t } = useTranslation('common');
  return (status) => t(`status.${status}`);
}

export function useRelationshipLabel(): (relationship: Relationship) => string {
  const { t } = useTranslation('common');
  return (relationship) => t(`relationship.${relationship}`);
}

export function useChannelLabel(): (channel: Channel) => string {
  const { t } = useTranslation('common');
  return (channel) => t(`channel.${channel}`);
}

export function useContactRoleLabel(): (role: ContactRole) => string {
  const { t } = useTranslation('common');
  return (role) => t(`contactRole.${role}`);
}
