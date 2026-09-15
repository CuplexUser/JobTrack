/** Tiny result builders shared by every tool module, so a handler is one line of business
 * logic plus one of these rather than repeating the MCP content-block shape everywhere. */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AlreadyAppliedError, DuplicateOpeningError } from '@jobtrack/api/services/ingest';
import { applicationSummary, openingSummary } from './views.js';

/**
 * Serialized without indentation on purpose. Pretty-printing a page of records roughly
 * doubles its character count, and an MCP client counts every one of those characters
 * against the ceiling it will accept for a single tool result — indentation is the
 * cheapest thing to give up, since nothing reading this needs it.
 */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * The answer a saving tool gives when the save was refused as a duplicate: not an error,
 * since "you have this already" is a useful result, but `saved: false` with the reason and
 * the record it collided with. Null for any other failure, which the caller rethrows.
 */
export function duplicateRefusal(error: unknown) {
  if (error instanceof DuplicateOpeningError) {
    return {
      saved: false as const,
      reason: error.message,
      existingKind: 'opening' as const,
      existing: openingSummary(error.existing),
    };
  }
  if (error instanceof AlreadyAppliedError) {
    return {
      saved: false as const,
      reason: error.message,
      existingKind: 'application' as const,
      existing: applicationSummary(error.existing),
    };
  }
  return null;
}
