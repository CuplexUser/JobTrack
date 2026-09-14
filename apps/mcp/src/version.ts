/**
 * This package's own version, for the startup line and the MCP handshake, so a client's log
 * says which server it is talking to. Read from `package.json` at runtime for the same reason
 * `@jobtrack/api` does it (see its `version.ts`): this package ships TypeScript sources, so
 * there is no build step to bake a constant into.
 */

import { createRequire } from 'node:module';

export const MCP_VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
