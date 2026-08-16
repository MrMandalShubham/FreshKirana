import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../modules/identity/contracts';
import { registry } from './metrics';

/**
 * Prometheus scrape endpoint (§2.16).
 *
 * Public because scrapers do not carry bearer tokens; in deployed environments
 * it is reachable only from inside the cluster network, never from the internet.
 */
@Controller('metrics')
export class MetricsController {
  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    return registry.metrics();
  }
}
