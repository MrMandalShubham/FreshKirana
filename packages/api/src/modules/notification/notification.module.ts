import { Module } from '@nestjs/common';

/**
 * Notification module - WhatsApp, push, SMS, email, in-app; templates and preferences.
 *
 * Owns the `notification` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (spec 2.1.1, rule R2).
 */
@Module({})
export class NotificationModule {}
