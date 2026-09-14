/**
 * Posting capture — the MCP counterpart of the web app's "Save from posting" and the
 * browser extension. Reads a link or parses pasted text through the same
 * `ingest.service.ts` path, so the draft and the duplicate verdict are exactly what the web
 * app would show, and saving goes through `clipPosting`, which refuses a posting that is
 * already saved.
 */

import { capturePostingSchema, isUsableDraft, postingDraftSchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import {
  DuplicateOpeningError,
  IngestBlockedError,
  clipPosting,
  ingestText,
  ingestUrl,
  type IngestResult,
} from '@jobtrack/api/services/ingest';
import { scorePostings } from '@jobtrack/api/services/fit';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult, jsonResult } from '../helpers.js';
import { contactSummary, fitSummary, openingSummary } from '../views.js';

/**
 * How much of a posting's description comes back. Enough to judge the role and write a
 * cover letter from; the full text is still saved on the opening.
 */
const DESCRIPTION_CHARS = 4000;

/** The draft with its description capped, and the duplicate verdict's people summarized. */
function trimDraft(result: IngestResult) {
  const notes = result.draft.notes;
  const duplicate = { ...result.duplicate, contacts: result.duplicate.contacts.map(contactSummary) };
  if (!notes || notes.length <= DESCRIPTION_CHARS) return { draft: result.draft, duplicate };
  return {
    draft: { ...result.draft, notes: `${notes.slice(0, DESCRIPTION_CHARS)}…` },
    duplicate,
    notesTruncated: true as const,
  };
}

export function registerCaptureTool(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'capture_posting',
    {
      description:
        "Read a job posting into a draft opening, from a `url` (read from the site's schema.org JobPosting data; works on most career pages and applicant tracking systems such as Greenhouse, Lever, Workday and Teamtailor) or from pasted `text` (optionally with the `url` it came from). Returns the draft plus the same duplicate verdict check_duplicate gives, and, when the user has a profile, the posting's `fit` (0 to 100, with reasons) so you can say whether it is worth saving before you do. With `save: true` the draft is also saved as an opening, unless that posting is already saved. LinkedIn, Indeed and Glassdoor block automated readers: for those, ask the user to paste the posting text or use the JobTrack browser extension.",
      inputSchema: capturePostingSchema,
    },
    async ({ url, text, save }) => {
      let result: IngestResult;
      try {
        result =
          text !== undefined
            ? await ingestText(repos, search, text, url)
            : await ingestUrl(repos, search, url!);
      } catch (error) {
        if (error instanceof IngestBlockedError) {
          return errorResult(`${error.message} Ask the user to paste the posting text, then call capture_posting with \`text\`.`);
        }
        return errorResult(error instanceof Error ? error.message : 'Could not read that posting');
      }

      // Scored on the full description, before it is trimmed for the reply. A draft without a
      // title has nothing to score.
      const [fit] = result.draft.jobTitle.trim()
        ? await scorePostings(repos, search, [result.draft])
        : [null];
      const fitPart = fit ? { fit: fitSummary(fit) } : {};

      if (!save) return jsonResult({ ...trimDraft(result), ...fitPart, saved: false });

      if (!isUsableDraft(result.draft)) {
        return jsonResult({
          ...trimDraft(result),
          ...fitPart,
          saved: false,
          reason:
            'The company or job title could not be identified, so nothing was saved. Ask the user for them and call create_opening with the corrected fields.',
        });
      }

      try {
        const clipped = await clipPosting(repos, search, postingDraftSchema.parse(result.draft));
        search.markStale();
        return jsonResult({
          saved: true,
          opening: openingSummary({ ...clipped.opening, fit }),
          duplicate: { ...clipped.duplicate, contacts: clipped.duplicate.contacts.map(contactSummary) },
        });
      } catch (error) {
        if (error instanceof DuplicateOpeningError) {
          return jsonResult({ saved: false, reason: error.message, existing: openingSummary(error.existing) });
        }
        throw error;
      }
    },
  );
}
