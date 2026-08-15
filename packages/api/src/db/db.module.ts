import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { closeDatabase, createDatabase, type Database } from './index';

export const DATABASE = Symbol('DATABASE');

/**
 * Database access for every module.
 *
 * Global because every bounded context needs a handle, but note that sharing a
 * *connection* is not sharing *tables*: each module may only touch its own
 * PostgreSQL schema (§2.1.1), enforced by scripts/check-schema-ownership.mjs.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): Database => createDatabase(),
    },
  ],
  exports: [DATABASE],
})
export class DbModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await closeDatabase();
  }
}
