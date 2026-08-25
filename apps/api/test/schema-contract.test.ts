/**
 * The database rows and the wire types are declared in two different packages, on purpose:
 * `packages/shared` must stay browser-safe and cannot import repolayer. That split is only
 * safe if something checks the two never drift, which is what this file does — at compile
 * time, so a mismatch is a build failure rather than a runtime surprise.
 */

import { describe, expectTypeOf, it, expect } from 'vitest';
import type {
  ApplicationRow,
  CompanyRow,
  JobOpeningRow,
  NoteRow,
  StatusEventRow,
  TagRow,
} from '../src/db/schema.js';
import type { JobApplication, JobOpening, Company, Note, StatusEvent, Tag } from '@jobtrack/shared';
import { toApplication, toCompany, toNote, toOpening, toStatus, toTag, toWorkMode } from '../src/db/mappers.js';

describe('row and wire types line up', () => {
  it('every wire field has a row field behind it', () => {
    // The row types carry Dates where the wire carries strings, so these compare the
    // *field names* rather than the value types.
    expectTypeOf<keyof JobApplication>().toExtend<keyof ApplicationRow | 'appliedOn' | 'followUpOn'>();
    expectTypeOf<keyof Company>().toExtend<keyof CompanyRow>();
    expectTypeOf<keyof Tag>().toExtend<keyof TagRow>();
    expectTypeOf<keyof Note>().toExtend<keyof NoteRow>();
    expectTypeOf<keyof JobOpening>().toExtend<keyof JobOpeningRow | 'savedOn'>();
  });

  it('mappers produce the wire shapes', () => {
    expectTypeOf(toApplication).returns.toEqualTypeOf<JobApplication>();
    expectTypeOf(toCompany).returns.toEqualTypeOf<Company>();
    expectTypeOf(toTag).returns.toEqualTypeOf<Tag>();
    expectTypeOf(toNote).returns.toEqualTypeOf<Note>();
    expectTypeOf(toOpening).returns.toEqualTypeOf<JobOpening>();
  });

  it('status event maps comment_text onto the clean wire name', () => {
    expectTypeOf<StatusEvent>().toHaveProperty('comment');
    expectTypeOf<StatusEventRow>().toHaveProperty('commentText');
  });
});

describe('narrowing stored strings back to unions', () => {
  it('accepts known values', () => {
    expect(toStatus('interview')).toBe('interview');
    expect(toWorkMode('remote')).toBe('remote');
  });

  it('falls back rather than throwing on an unknown value', () => {
    // A row written by hand or by an older version should render as something sensible
    // instead of taking down the whole list endpoint.
    expect(toStatus('not-a-status')).toBe('applied');
    expect(toWorkMode('teleport')).toBe('unspecified');
  });
});
