import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InboxController } from './internal/inbox.controller';
import { NotificationService } from './internal/notification.service';
import { MockWhatsAppChannel, WHATSAPP_CHANNEL } from './internal/whatsapp.channel';

/**
 * Notification module — WhatsApp, push, SMS, email (spec §2.12).
 *
 * Owns the `notification` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * Deliberately knows nothing about orders. It is handed a phone number, a
 * template and some variables — which is what keeps it from becoming the place
 * where business rules quietly accumulate, and what avoids a cycle with the
 * modules that need to send things.
 *
 * The channel is bound here, so swapping the mock for a real BSP (B1) is one
 * line in this file plus an implementation.
 */
@Module({
  imports: [IdentityModule],
  controllers: [InboxController],
  providers: [
    NotificationService,
    MockWhatsAppChannel,
    { provide: WHATSAPP_CHANNEL, useExisting: MockWhatsAppChannel },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
