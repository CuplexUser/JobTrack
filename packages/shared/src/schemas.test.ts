import { describe, expect, it } from 'vitest';
import {
  applicationFilterSchema,
  bulkStatusChangeSchema,
  capturePostingSchema,
  openingFilterSchema,
} from './schemas.js';

describe('applicationFilterSchema location', () => {
  it('splits on "|" rather than ",", since locations contain commas', () => {
    const parsed = applicationFilterSchema.parse({ location: 'Stockholm, Sweden|Lund' });
    expect(parsed.location).toEqual(['Stockholm, Sweden', 'Lund']);
  });

  it('accepts an array as-is, the way an MCP tool call sends it', () => {
    const parsed = applicationFilterSchema.parse({ location: ['Göteborg', ' Malmö '] });
    expect(parsed.location).toEqual(['Göteborg', 'Malmö']);
  });

  it('treats empty terms as no filter', () => {
    expect(applicationFilterSchema.parse({ location: ' | ' }).location).toBeUndefined();
  });
});

describe('openingFilterSchema', () => {
  it('reads includeArchived from a URL string or a JSON boolean', () => {
    expect(openingFilterSchema.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
    expect(openingFilterSchema.parse({ includeArchived: false }).includeArchived).toBe(false);
    expect(openingFilterSchema.parse({}).includeArchived).toBeUndefined();
  });

  it('splits locations on "|" like the applications filter', () => {
    expect(openingFilterSchema.parse({ location: 'Lund|Malmö, Sweden' }).location).toEqual(['Lund', 'Malmö, Sweden']);
  });
});

describe('capturePostingSchema', () => {
  it('needs a url or text', () => {
    expect(capturePostingSchema.safeParse({}).success).toBe(false);
    expect(capturePostingSchema.parse({ url: 'https://example.com/job/1' }).save).toBe(false);
    expect(capturePostingSchema.safeParse({ text: 'Backend Engineer at Spotify', save: true }).success).toBe(true);
  });
});

describe('bulkStatusChangeSchema', () => {
  it('defaults the comment to null and rejects an empty id list', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(bulkStatusChangeSchema.parse({ ids: [id], status: 'ghosted' }).comment).toBeNull();
    expect(bulkStatusChangeSchema.safeParse({ ids: [], status: 'ghosted' }).success).toBe(false);
  });
});
