import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reports ok', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('freshkirana-api');
  });

  it('returns a parseable ISO timestamp', () => {
    const { timestamp } = controller.check();
    expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
  });

  it('reports non-negative uptime', () => {
    expect(controller.check().uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
