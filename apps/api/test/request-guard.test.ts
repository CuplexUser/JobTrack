/**
 * The origin guard.
 *
 * This is the regression that matters most in the capture work: before it, the API
 * reflected any origin and required no authentication, so every page open in the browser on
 * this machine could read and write the whole database. The clipper is what made that
 * reachable in practice, so the guard ships in the same change.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { isAllowedOrigin } from '../src/lib/request-guard.js';
import { testDeps } from './support/repos.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp(
    testDeps({ config: { corsOrigins: ['http://localhost:5173'], apiToken: 'test-token' } }),
  );
});

afterEach(async () => {
  await app.close();
});

describe('isAllowedOrigin', () => {
  it('treats a missing origin as a non-browser caller', () => {
    expect(isAllowedOrigin(undefined, [])).toBe(true);
  });

  it('ignores case and a trailing slash', () => {
    expect(isAllowedOrigin('HTTP://LocalHost:5173/', ['http://localhost:5173'])).toBe(true);
  });

  it('does not treat a lookalike host as the real one', () => {
    expect(isAllowedOrigin('http://localhost:5173.evil.com', ['http://localhost:5173'])).toBe(false);
    expect(isAllowedOrigin('https://localhost:5173', ['http://localhost:5173'])).toBe(false);
  });
});

describe('the guard on /api', () => {
  it('lets a request with no Origin through — curl, the MCP server, the tray itself', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/applications' });
    expect(response.statusCode).toBe(200);
  });

  it('lets the app’s own UI through', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a page you merely happened to visit', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { origin: 'https://evil.example' },
      payload: { companyName: 'Evil', jobTitle: 'Injected', appliedOn: '2026-01-01' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toMatch(/not allowed/i);
  });

  it('lets an unknown origin through when it presents the token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { origin: 'chrome-extension://abcdef', authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('accepts the token in the X-JobTrack-Token header too', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { origin: 'chrome-extension://abcdef', 'x-jobtrack-token': 'test-token' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('refuses a wrong token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { origin: 'chrome-extension://abcdef', authorization: 'Bearer nope' },
    });
    expect(response.statusCode).toBe(403);
  });

  /**
   * The bug this pair exists for. Browsers omit `Origin` on a GET, so a wrong token on one
   * used to be waved through by the "no Origin, therefore not a browser" rule — and the
   * extension's setup page, which tested with exactly such a GET, reported success for
   * anything typed into it.
   */
  it('refuses a wrong token even where the request would have been allowed without one', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { authorization: 'Bearer nope' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('bad_token');
  });

  it('still allows the same request when no token is claimed at all', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/applications' });
    expect(response.statusCode).toBe(200);
  });
});

describe('GET /api/auth/check', () => {
  it('accepts the right token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
      headers: { authorization: 'Bearer test-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('refuses a wrong one', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
      headers: { authorization: 'Bearer nope' },
    });
    expect(response.statusCode).toBe(403);
  });

  // The check has to be about the token and nothing else, or it cannot answer the question
  // it was added for — being on the allowlist must not stand in for having credentials.
  it('refuses a request with no token, even from an allowed origin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/check',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a request with no token and no origin', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/check' });
    expect(response.statusCode).toBe(403);
  });

  it('leaves the health probe open, so a client can find the app before it has a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/meta',
      headers: { origin: 'chrome-extension://abcdef' },
    });
    expect(response.statusCode).toBe(200);
  });
});
