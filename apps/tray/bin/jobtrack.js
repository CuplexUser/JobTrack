#!/usr/bin/env node

// The published package ships TypeScript sources rather than a compiled build (matching
// apps/api and apps/mcp, which also run straight off `src/` via tsx). Registering tsx's ESM
// loader here — instead of shelling out to the `tsx` CLI — keeps this bin file a plain,
// synchronous-to-resolve entry point that `npm`'s generated Windows .cmd/.ps1 shims can call
// with plain `node`.
import { register } from 'node:module';

register('tsx/esm', import.meta.url);

await import(new URL('../src/cli.ts', import.meta.url));
