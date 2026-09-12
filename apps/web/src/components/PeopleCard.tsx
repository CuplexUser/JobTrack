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

function lastSpoke(contact: ContactView): string {
  return contact.lastInteractionOn ? `last spoke ${contact.lastInteractionOn}` : 'no conversations logged';
}

function PersonMeta({ contact }: { contact: ContactView }) {
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
            {lastSpoke(contact)}
          </Typography.Text>
        </Space>
      }
    />
  );
}

/** Everyone the user knows at a company. */
export function CompanyPeopleCard({ companyName }: { companyName: string }) {
  const { data, isLoading } = useContacts({ company: companyName });
  const [adding, setAdding] = useState(false);
  const [talkingTo, setTalkingTo] = useState<ContactView | null>(null);
  const people = data?.contacts ?? [];

  return (
    <Card
      title={`People you know at ${companyName} (${people.length})`}
      loading={isLoading}
      extra={
        <Button size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          Add person
        </Button>
      }
    >
      {people.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nobody you know works here yet" />
      ) : (
        <List
          dataSource={people}
          renderItem={(contact) => (
            <List.Item
              actions={[
                <Tooltip key="log" title="Log a conversation">
                  <Button type="text" icon={<MessageOutlined />} onClick={() => setTalkingTo(contact)} />
                </Tooltip>,
              ]}
            >
              <PersonMeta contact={contact} />
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
      message.success(`Linked ${contact.name}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not link');
    }
  }

  const roleMenu = (contact: ContactView) => ({
    items: CONTACT_ROLES.map((role) => ({ key: role, label: CONTACT_ROLE_LABELS[role] })),
    onClick: ({ key }: { key: string }) => void linkAs(contact, key),
  });

  return (
    <Card
      title={`People (${linked.length})`}
      extra={
        <Button size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          Add person
        </Button>
      }
    >
      {linked.length === 0 && others.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`You don't know anyone at ${application.company.name} yet`}
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
                    <Tooltip key="log" title="Log a conversation about this application">
                      <Button type="text" icon={<MessageOutlined />} onClick={() => setTalkingTo(contact)} />
                    </Tooltip>,
                    <Tooltip key="unlink" title="Unlink">
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
                    description={contact.headline ?? lastSpoke(contact)}
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
                  Also at {application.company.name}
                </Typography.Text>
              }
              dataSource={others}
              renderItem={(contact) => (
                <List.Item
                  actions={[
                    <Dropdown key="link" menu={roleMenu(contact)} trigger={['click']}>
                      <Button size="small" icon={<LinkOutlined />}>
                        Link
                      </Button>
                    </Dropdown>,
                  ]}
                >
                  <PersonMeta contact={contact} />
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
