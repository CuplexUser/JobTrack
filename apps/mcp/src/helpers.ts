/** Tiny result builders shared by every tool module, so a handler is one line of business
 * logic plus one of these rather than repeating the MCP content-block shape everywhere. */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
