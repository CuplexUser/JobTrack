import { describe, expect, it } from 'vitest';
import { applicationFilterSchema } from './schemas.js';

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
