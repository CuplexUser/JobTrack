# Networking

The people behind a job search: who you know at a company, what you last talked about, who
referred you, and who you meant to get back in touch with. A referral does more for an
application than almost anything else, and the moment it helps most is before you apply, so
JobTrack surfaces your contacts exactly there.

---

## The model

Three tables, all added alongside the existing ones (nothing existing is altered, so a
database from before this feature upgrades in place the first time the app starts):

| table | holds |
|---|---|
| `contacts` | a person: name, employer, their role, how you know them, email/phone/LinkedIn, notes, a reconnect date, and when LinkedIn says you connected |
| `interactions` | a dated conversation: channel, who reached out, a summary, and optionally the application it was about |
| `contact_links` | a person's part in an application or opening: referral, recruiter, interviewer or contact |

**A contact's employer is a name, not a company record.** The contact stores the employer's
name and its normalized key (the same `companyKey` that makes "Spotify AB" and "Spotify" one
company). "Who do I know at Spotify?" is then an equality match on that key. This is
deliberate: a LinkedIn network spans hundreds of employers you will never apply to, and
creating a Company for each would bury the ones you track. It also works in either order. Add
a person at a company you have never heard of today, apply there next month, and they show
up on the new company's page and in the duplicate check without anything being relinked.
Renaming a company carries its people along to the new name.

---

## Where people show up

- **Before you apply.** The duplicate check on the New Application form, the dashboard's
  *Check before you apply* box and posting capture all list the people you know at that
  employer, closest first (anyone you have actually talked to, or a recruiter or referrer,
  ahead of a connection you have never spoken to). This works for a company that is new to
  JobTrack too.
- **People page.** Everyone, filterable by name, employer, role, notes and relationship,
  with a *Due a reconnect* view.
- **Company page.** Everyone you know at that company.
- **Application page.** The people linked to that application with their role, plus the rest
  of your network at the company, each one click away from being linked.
- **Dashboard and agenda.** People whose reconnect date has arrived sit next to due
  follow-ups and quiet applications, in *Needs attention* and in `GET /api/agenda`.
- **Search.** People are indexed by name, employer, role, notes and what was said in
  conversations with them, so "recruiter payments" finds the recruiter who mentioned the
  payments team.

Logging a conversation can set the next reconnect date in the same step, because "talked to
her, check back in a month" is one thought.

---

## Importing your LinkedIn connections

LinkedIn lets every member download a copy of their own data: **Settings → Data privacy →
Get a copy of your data**, then choose *Connections*. The archive LinkedIn emails you
contains `Connections.csv`. On the People page, *Import LinkedIn connections* reads it.

This is the only LinkedIn route JobTrack takes, for the same reason
[capture](capture.md#what-works-where-and-why) avoids reading LinkedIn from a server: the
file is your own data, handed to you by LinkedIn. JobTrack never fetches or scrapes profiles.

How the import behaves:

- **Preview first.** Nothing is written until you confirm. The preview counts new people, how
  many of them work at companies already in JobTrack (the ones that matter for your search
  today), and anyone already added.
- **Safe to repeat.** A person is recognized by their profile link, or, when the file has no
  link, by name and employer. Importing a newer export later adds only the new connections.
- **Fast for large networks.** Rows are inserted in batches inside one transaction, so a
  network of thousands imports in one go and a failure part-way leaves nothing half-imported.
- **Nothing else is created.** Imported people get the relationship *Connection* and no
  company records are made for their employers.

The file opens with a few lines of notes before the header row; the parser finds the header
by name, so it copes with that and with a file tidied up in a spreadsheet first. LinkedIn's
"12 Mar 2024" dates and ISO dates are both read.

---

## From Claude Desktop

The MCP server has `list_contacts`, `get_contact`, `create_contact`, `update_contact`,
`log_interaction`, `link_contact` and `list_linked_contacts`, and `check_duplicate` and
`get_agenda` include people. There are no delete tools and no import tool: removing a person
and choosing a file to import stay with you in the web app.

The `draft_outreach` prompt takes a company name or an opening/application id, finds who you
know there, suggests who is best placed to help, drafts a short message, and logs the
conversation (and links the person) once you confirm you sent it. `weekly_review` also walks
through the people due a reconnect.
