/** Tiny result builders shared by every tool module, so a handler is one line of business
 * logic plus one of these rather than repeating the MCP content-block shape everywhere. */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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
