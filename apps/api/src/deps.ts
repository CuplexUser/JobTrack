/**
 * What every route needs. Passed explicitly rather than decorated onto the Fastify
 * instance, so a test can build a server over MemoryRepo and a fake embedder with no
 * global state involved.
 */

import type { Config } from './config.js';
import type { Repos } from './db/repos.js';
import type { SearchIndex } from './search/index.js';

export interface Deps {
  repos: Repos;
  search: SearchIndex;
  config: Config;
}
