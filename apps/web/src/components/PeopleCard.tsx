/**
 * "Who do I know here?" on the company and application pages.
 *
 * On a company it lists everyone at that employer. On an application it separates the people
 * who played a part (linked, with their role) from everyone else at the company, who can be
 * linked with one click. Both match people to the company by name, so a contact typed in as
 * "Spotify AB" still turns up on Spotify's page.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App as AntApp, Button, Card, Dropdown, Empty, List, Space, Tag, Tooltip, Typography } from 'antd';
import { DisconnectOutlined, LinkOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  CONTACT_ROLES,
  CONTACT_ROLE_LABELS,
  RELATIONSHIP_LABELS,
  type ContactView,
  type JobApplicationView,
  type LinkedContact,
} from '@jobtrack/shared';
import { useContacts, useLinkContact, useLinkedContacts, useUnlinkContact } from '../api/hooks.js';
import { ContactDrawer } from './ContactDrawer.js';
import { InteractionModal } from './InteractionModal.js';

function lastSpoke(contact: ContactView, t: TFunction<'contacts'>): string {
  return contact.lastInteractionOn
    ? t('peopleCard.lastSpoke', { date: contact.lastInteractionOn })
    : t('peopleCard.noConversations');
}

function PersonMeta({ contact, t }: { contact: ContactView; t: TFunction<'contacts'> }) {
  return (
    <List.Item.Meta
      title={
        <Space size={8} wrap>
          <Link to={`/people/${contact.id}`}>{contact.name}</Link>
          <Tag>{RELATIONSHIP_LABELS[contact.relationship]}</Tag>
        </Space>
      }
      description={
        <Space size={8} wrap>
          {contact.headline && <span>{contact.headline}</span>}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {lastSpoke(contact, t)}
          </Typography.Text>
        </Space>
      }
    />
  );
}

/** Everyone the user knows at a company. */
export function CompanyPeopleCard({ companyName }: { companyName: string }) {
  const { t } = useTranslation('contacts');
  const { data, isLoading } = useContacts({ company: companyName });
  const [adding, setAdding] = useState(false);
  const [talkingTo, setTalkingTo] = useState<ContactView | null>(null);
  const people = data?.contacts ?? [];

  return (
    <Card
      title={t('peopleCard.companyTitle', { company: companyName, count: people.length })}
      loading={isLoading}
      extra={
        <Button size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          {t('peopleCard.addPerson')}
        </Button>
      }
    >
      {people.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('peopleCard.companyEmpty')} />
      ) : (
        <List
          dataSource={people}
          renderItem={(contact) => (
            <List.Item
              actions={[
                <Tooltip key="log" title={t('peopleCard.logConversation')}>
                  <Button type="text" icon={<MessageOutlined />} onClick={() => setTalkingTo(contact)} />
                </Tooltip>,
              ]}
            >
              <PersonMeta contact={contact} t={t} />
            </List.Item>
          )}
        />
      )}

      <ContactDrawer open={adding} onClose={() => setAdding(false)} defaults={{ companyName }} />
      <InteractionModal open={talkingTo !== null} contact={talkingTo} onClose={() => setTalkingTo(null)} />
    </Card>
  );
}

/** The people behind one application, and the rest of the user's network at that company. */
export function ApplicationPeopleCard({ application }: { application: JobApplicationView }) {
  const { t } = useTranslation('contacts');
  const { message } = AntApp.useApp();
  const { data: linkedData } = useLinkedContacts('application', application.id);
  const { data: companyData } = useContacts({ company: application.company.name });
  const link = useLinkContact();
  const unlink = useUnlinkContact();
  const [adding, setAdding] = useState(false);
  const [talkingTo, setTalkingTo] = useState<ContactView | null>(null);

  const linked: LinkedContact[] = linkedData?.contacts ?? [];
  const linkedIds = new Set(linked.map((contact) => contact.id));
  const others = (companyData?.contacts ?? []).filter((contact) => !linkedIds.has(contact.id));

  async function linkAs(contact: ContactView, role: string): Promise<void> {
    try {
      await link.mutateAsync({ contactId: contact.id, body: { targetType: 'application', targetId: application.id, role } });
      message.success(t('peopleCard.linkSuccess', { name: contact.name }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('peopleCard.linkError'));
    }
  }

  const roleMenu = (contact: ContactView) => ({
    items: CONTACT_ROLES.map((role) => ({ key: role, label: CONTACT_ROLE_LABELS[role] })),
    onClick: ({ key }: { key: string }) => void linkAs(contact, key),
  });

  return (
    <Card
      title={t('peopleCard.applicationTitle', { count: linked.length })}
      extra={
        <Button size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          {t('peopleCard.addPerson')}
        </Button>
      }
    >
      {linked.length === 0 && others.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('peopleCard.applicationEmpty', { company: application.company.name })}
        />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {linked.length > 0 && (
            <List
              size="small"
              dataSource={linked}
              renderItem={(contact) => (
                <List.Item
                  actions={[
                    <Tooltip key="log" title={t('peopleCard.logConversationAboutApplication')}>
                      <Button type="text" icon={<MessageOutlined />} onClick={() => setTalkingTo(contact)} />
                    </Tooltip>,
                    <Tooltip key="unlink" title={t('peopleCard.unlink')}>
                      <Button
                        type="text"
                        icon={<DisconnectOutlined />}
                        onClick={() => unlink.mutate(contact.linkId)}
                      />
                    </Tooltip>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space size={8} wrap>
                        <Link to={`/people/${contact.id}`}>{contact.name}</Link>
                        <Tag color="blue">{CONTACT_ROLE_LABELS[contact.role]}</Tag>
                      </Space>
                    }
                    description={contact.headline ?? lastSpoke(contact, t)}
                  />
                </List.Item>
              )}
            />
          )}

          {others.length > 0 && (
            <List
              size="small"
              header={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('peopleCard.alsoAt', { company: application.company.name })}
                </Typography.Text>
              }
              dataSource={others}
              renderItem={(contact) => (
                <List.Item
                  actions={[
                    <Dropdown key="link" menu={roleMenu(contact)} trigger={['click']}>
                      <Button size="small" icon={<LinkOutlined />}>
                        {t('peopleCard.link')}
                      </Button>
                    </Dropdown>,
                  ]}
                >
                  <PersonMeta contact={contact} t={t} />
                </List.Item>
              )}
            />
          )}
        </Space>
      )}

      <ContactDrawer
        open={adding}
        onClose={() => setAdding(false)}
        defaults={{ companyName: application.company.name }}
      />
      <InteractionModal
        open={talkingTo !== null}
        contact={talkingTo}
        applicationId={application.id}
        onClose={() => setTalkingTo(null)}
      />
    </Card>
  );
}
