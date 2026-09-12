/**
 * MCP prompts: ready-made workflows an MCP client offers as commands (in Claude Desktop,
 * the "+" menu). Each one is a script, not logic. It tells the model which JobTrack tools to
 * call and in what order, so a routine job-search chore runs the same careful way every
 * time instead of depending on how the request happened to be worded.
 *
 * Two rules run through all of them: read before writing, and ask the user before any change
 * they did not already ask for. The tools deliberately have no delete, and these prompts
 * never archive or change a status without a yes.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

function userPrompt(text: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] };
}

export const PROMPT_NAMES = [
  'weekly_review',
  'triage_openings',
  'log_email_update',
  'prepare_application',
  'interview_prep',
] as const;

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'weekly_review',
    {
      title: 'Weekly job search review',
      description: 'Go through what is waiting on you, decide on follow-ups and quiet applications, and summarize the week.',
    },
    () =>
      userPrompt(`Run my weekly job search review using the JobTrack tools.

1. Call get_agenda and get_dashboard.
2. Follow-ups due: for each, tell me what it is and when I applied, and suggest a short follow-up message I could send. Ask whether to push the follow-up date out (update_application with a new followUpOn) or mark a response (change_application_status).
3. Gone quiet: list them with how many days they have been silent. Suggest which look worth one more nudge and which to mark ghosted. Only after I confirm, call bulk_change_status for the ones I choose, with a comment saying why.
4. Idle openings: list them oldest first and ask, for each, whether to apply now (convert_opening_to_application), keep it, or archive it (update_opening with archived: true).
5. Finish with a short summary: applications this month, response rate, the funnel, and the one or two things most worth doing this week.

Keep it concise and do not change anything I have not agreed to.`),
  );

  server.registerPrompt(
    'triage_openings',
    {
      title: 'Triage saved openings',
      description: 'Decide, opening by opening, what to apply to, what to research and what to let go.',
    },
    () =>
      userPrompt(`Help me triage my saved job openings in JobTrack.

1. Call list_openings. For any opening whose notes were cut short, call get_opening when you need the full posting.
2. For each opening, call check_duplicate with its company and title so you know whether I have applied there before and how that went (get_application on a prior match if it matters).
3. Give me a table: company, title, location, how long it has been saved, prior history at the company, and your recommendation (apply / research first / archive) with a one-line reason.
4. Then ask me what to do. For the ones I want to apply to, call convert_opening_to_application. For the ones I want gone, call update_opening with archived: true. Do nothing without my go-ahead.`),
  );

  server.registerPrompt(
    'log_email_update',
    {
      title: 'Log an email from an employer',
      description: 'Paste an email (rejection, interview invite, recruiter reply) and record it on the right application.',
      argsSchema: { email: z.string().describe('The email text, pasted in full') },
    },
    ({ email }) =>
      userPrompt(`Record this email from an employer in JobTrack.

<email>
${email}
</email>

1. Work out the company, the role, and what the email means: a rejection, a screening call, an interview invitation, an offer, or just an acknowledgement.
2. Find the application: list_applications with q set to the company (and the role if the company has several). If more than one could match, show me the candidates and ask. If none exists, tell me and offer to create it with create_application (call check_duplicate first).
3. Tell me the change you intend to make, then, once I agree:
   - a status change goes through change_application_status, with occurredOn set to the email's date when it has one and a short comment summarizing the email;
   - a scheduled call or interview also gets followUpOn set to that date via update_application;
   - anything worth remembering (names, times, next steps) goes into a note with create_note, attached to the application.
4. Confirm what was recorded.`),
  );

  server.registerPrompt(
    'prepare_application',
    {
      title: 'Prepare an application',
      description: 'Gather everything known about a saved opening or application and draft a tailored cover letter.',
      argsSchema: { id: z.string().describe('The id of a saved opening or an application') },
    },
    ({ id }) =>
      userPrompt(`Help me prepare a job application with JobTrack. The id is ${id}.

1. Call get_opening with that id; if there is no such opening, call get_application instead.
2. Call get_company for the employer, to see my history there and any notes I have kept. Call list_notes with that company as the target for anything else.
3. Summarize the role: what they are asking for, the must-haves versus nice-to-haves, and anything in my history with this company that I should keep in mind.
4. Ask me for anything you need that JobTrack does not have (my CV or the experience I want to highlight), then draft a tailored cover letter. Keep it specific to the posting and under 350 words.
5. When I am happy with it, save it with create_note (title "Cover letter: <job title>") attached to the application, or to the company if this is still an opening. If it is an opening and I say I have applied, call convert_opening_to_application first and attach the note to the new application.`),
  );

  server.registerPrompt(
    'interview_prep',
    {
      title: 'Interview preparation',
      description: 'Build an interview prep sheet from an application, its history and your notes.',
      argsSchema: { id: z.string().describe('The id of the application') },
    },
    ({ id }) =>
      userPrompt(`Help me prepare for an interview. The JobTrack application id is ${id}.

1. Call get_application for the role, its status history and notes, and get_company for the employer and my other applications there.
2. Write a prep sheet: what the role is about, what they will likely probe given the posting, where my history at this company (earlier rounds, earlier rejections and their stated reasons) should shape my answers, and questions worth asking them.
3. Suggest a few likely interview questions with a note on how to approach each.
4. Offer to save the prep sheet as a note on the application (create_note), and to set followUpOn to the interview date if I tell you when it is.`),
  );
}
