import { Controller, Get } from '@nestjs/common';
import { Public } from '../modules/identity/contracts';

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

/**
 * Liveness endpoint. Deliberately dependency-free so it answers even when
 * downstream services are degraded - the deploy pipeline (P0.5) uses it as the
 * container health check.
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'freshkirana-api',
      version: process.env['npm_package_version'] ?? '0.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
