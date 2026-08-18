import { describe, expect, it } from 'vitest';
import { applyPatch } from './merge-patch';

/** Exactly how the ValidationPipe hands a partial DTO to a service. */
class UpdateThingDto {
  status?: string;
  licenceNo?: string;
  note?: string;
}

describe('applyPatch', () => {
  const existing = { status: 'PENDING', licenceNo: '12345', note: 'hello' };

  it('keeps fields the caller did not send', () => {
    // The bug this exists for: a DTO instance has *every* declared field as an
    // own property, so a plain spread wipes the ones that were omitted.
    const dto = new UpdateThingDto();
    dto.status = 'ACTIVE';

    expect(Object.keys(dto)).toContain('licenceNo');
    expect({ ...existing, ...dto }.licenceNo).toBeUndefined();

    expect(applyPatch(existing, dto)).toEqual({
      status: 'ACTIVE',
      licenceNo: '12345',
      note: 'hello',
    });
  });

  it('applies the fields that were sent', () => {
    expect(applyPatch(existing, { status: 'SUSPENDED' }).status).toBe('SUSPENDED');
  });

  it('lets null through, because null is a value', () => {
    // Clearing a field is a real intent, and distinct from not mentioning it.
    expect(applyPatch(existing, { note: null }).note).toBeNull();
  });

  it('does not mutate the original', () => {
    applyPatch(existing, { status: 'ACTIVE' });
    expect(existing.status).toBe('PENDING');
  });
});
