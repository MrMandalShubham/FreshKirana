import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { requireDatabase } from '../../../testing/database';
import { BranchService } from './branch.service';
import { BranchStatus, GstRegistrationType } from './branch.dto';

/**
 * The branch record, and the messages a rejected write produces (P5.2a).
 *
 * ## Why this file exists
 *
 * The database CHECK constraints are the guarantee, but on their own they
 * surface as `violates check constraint "branch_gstin_shape"` — accurate, and
 * useless to whoever is filling in the form. `translateWriteError` maps each
 * one to a sentence that says what to fix, and it does that by **matching the
 * constraint name as a string**.
 *
 * That makes it invisible to the type checker and invisible to every test that
 * only exercises the happy path. Renaming the constraints in migration 0026 —
 * `vendor_*` to `branch_*` — broke every arm of that switch, and the whole
 * suite stayed green while a check violation fell through to the generic
 * message. These tests are the ones that would have caught it.
 */
describe('branch (e2e)', () => {
  let app: INestApplication;
  let branches: BranchService;

  const uniq = () => `br-${randomUUID().slice(0, 8)}`;

  /** A branch that satisfies every constraint; individual tests spoil one. */
  const valid = () => ({
    slug: uniq(),
    legalName: 'Kirana Traders Private Limited',
    displayName: 'Kirana Traders',
    phone: '+919000000001',
    addressLine: '14 Mandi Road',
    city: 'Nagpur',
    pincode: '440001',
  });

  beforeAll(async () => {
    if (!(await requireDatabase('branch.branch'))) return;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    branches = app.get(BranchService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('creating one', () => {
    it('starts it PENDING, never ACTIVE', async () => {
      const created = await branches.create(valid());

      // Going live is a deliberate act and needs an FSSAI licence (§3.7.3).
      // A branch that could be born ACTIVE would skip that check entirely.
      expect(created.status).toBe(BranchStatus.PENDING);
      expect(created.id).toBeTruthy();
    });

    it('refuses a duplicate slug with the slug in the message', async () => {
      const dto = valid();
      await branches.create(dto);

      await expect(branches.create({ ...dto })).rejects.toMatchObject({
        response: { message: expect.stringContaining(dto.slug) },
      });
    });
  });

  describe('a rejected write says what to fix', () => {
    it('names the pincode rule, not the constraint', async () => {
      await expect(
        branches.create({ ...valid(), pincode: '040001' }),
      ).rejects.toMatchObject({
        response: {
          message: 'pincode must be 6 digits and not start with 0',
        },
      });
    });

    it('names the missing GSTIN when registration claims one', async () => {
      // The invoice is issued under this GSTIN, so a branch claiming
      // registration without one produces an unissuable invoice at the first
      // order — which is why the database refuses it rather than the form.
      await expect(
        branches.create({
          ...valid(),
          gstRegistrationType: GstRegistrationType.REGISTERED,
        }),
      ).rejects.toMatchObject({
        response: {
          message: 'A GST-registered branch must have a GSTIN (§3.7.1)',
        },
      });
    });

    it('names the GSTIN shape when it is malformed', async () => {
      await expect(
        branches.create({
          ...valid(),
          gstRegistrationType: GstRegistrationType.REGISTERED,
          gstin: 'NOT-A-GSTIN',
        }),
      ).rejects.toMatchObject({
        response: { message: 'GSTIN is not a valid 15-character GSTIN' },
      });
    });

    it('never falls through to the raw constraint name', async () => {
      // The regression guard. If a constraint is renamed again and the switch
      // is not, the message becomes "Branch violates constraint branch_x" and
      // this fails — which is the whole point of the file.
      const failures = await Promise.allSettled([
        branches.create({ ...valid(), pincode: '000000' }),
        branches.create({
          ...valid(),
          gstRegistrationType: GstRegistrationType.REGISTERED,
        }),
        branches.create({
          ...valid(),
          gstRegistrationType: GstRegistrationType.REGISTERED,
          gstin: 'bad',
        }),
      ]);

      for (const outcome of failures) {
        expect(outcome.status).toBe('rejected');
        const message = String(
          (outcome as PromiseRejectedResult).reason?.response?.message ?? '',
        );
        expect(message).not.toContain('violates constraint');
      }
    });
  });

  describe('finding one', () => {
    it('reads back what was written', async () => {
      const created = await branches.create({ ...valid(), city: 'Wardha' });
      const found = await branches.findById(created.id);

      expect(found.city).toBe('Wardha');
      expect(found.slug).toBe(created.slug);
    });

    it('says so plainly when there is nothing there', async () => {
      await expect(branches.findById(randomUUID())).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
