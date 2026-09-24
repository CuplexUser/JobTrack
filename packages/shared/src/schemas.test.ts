import { describe, expect, it } from 'vitest';
import {
  applicationFilterSchema,
  bulkStatusChangeSchema,
  capturePostingSchema,
  DEFAULT_JOB_PLATFORMS,
  jobSourcesPatchSchema,
  jobSourcesSchema,
  openingFilterSchema,
  profilePatchSchema,
  profileSchema,
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

describe('profileSchema locations', () => {
  it('reads a flat list saved before priority levels as one level at full share', () => {
    const profile = profileSchema.parse({ targetTitles: ['Backend Engineer'], locations: ['Stockholm', 'Uppsala'] });
    expect(profile.locationTiers).toEqual([{ places: ['Stockholm', 'Uppsala'], share: 100 }]);
    expect(profile).not.toHaveProperty('locations');
  });

  it('prefers the levels when a document has both', () => {
    const profile = profileSchema.parse({ locations: ['Göteborg'], locationTiers: [{ places: ['Stockholm'], share: 70 }] });
    expect(profile.locationTiers).toEqual([{ places: ['Stockholm'], share: 70 }]);
  });

  it('turns an empty flat list into no levels at all', () => {
    expect(profileSchema.parse({ locations: [] }).locationTiers).toEqual([]);
  });

  it('caps the places across every level, not just within one', () => {
    const tier = (name: string, n: number) => ({ places: Array.from({ length: n }, (_, i) => `${name} ${i}`), share: 50 });
    expect(profilePatchSchema.safeParse({ locationTiers: [tier('A', 25), tier('B', 25)] }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ locationTiers: [tier('A', 25), tier('B', 26)] }).success).toBe(false);
  });

  it('refuses to save a place in two levels, however it is spelled', () => {
    const result = profilePatchSchema.safeParse({
      locationTiers: [
        { places: ['Malmö', 'Stockholm'], share: 100 },
        { places: ['stockholm'], share: 50 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('stockholm');
  });

  it('reads a place stored in two levels back in the higher one, rather than failing the profile', () => {
    const profile = profileSchema.parse({
      targetTitles: ['Backend Engineer'],
      locationTiers: [
        { places: ['Malmö', 'Stockholm'], share: 100 },
        { places: ['Stockholm'], share: 50 },
      ],
    });
    expect(profile.locationTiers).toEqual([{ places: ['Malmö', 'Stockholm'], share: 100 }]);
    expect(profile.targetTitles).toEqual(['Backend Engineer']);
  });

  it('rejects an empty level and a share outside 0 to 100', () => {
    expect(profilePatchSchema.safeParse({ locationTiers: [{ places: [], share: 50 }] }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ locationTiers: [{ places: ['Stockholm'], share: 101 }] }).success).toBe(false);
  });
});

describe('jobSourcesSchema', () => {
  it('starts with the default platforms and APIs until saved', () => {
    const sources = jobSourcesSchema.parse({});
    expect(sources.platforms.map((source) => source.name)).toEqual(DEFAULT_JOB_PLATFORMS.map((source) => source.name));
    expect(sources.apis[0]?.name).toBe('JobTech Jobsearch');
  });

  it('keeps an emptied list empty rather than restoring the defaults', () => {
    expect(jobSourcesSchema.parse({ platforms: [] }).platforms).toEqual([]);
  });

  it('leaves a list out of a patch rather than defaulting it', () => {
    expect(jobSourcesPatchSchema.parse({ apis: [] })).toEqual({ apis: [] });
  });
});
