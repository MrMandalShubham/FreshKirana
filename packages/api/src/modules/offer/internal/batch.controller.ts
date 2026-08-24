import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@freshkirana/contracts';
import { Roles, BranchScopeGuard } from '../../identity/contracts';
import { BatchService } from './batch.service';
import { ReceiveBatchDto } from './batch.dto';

/**
 * A store's lots (spec §1.7.3).
 *
 * Receiving stock names the batch it arrived in. Without that the shop has a
 * number and no idea which crate it came from, and a recall has nothing to
 * search.
 */
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF, Role.ADMIN, Role.OPS)
@UseGuards(BranchScopeGuard)
@Controller('branch/:branchId/offers/:offerId/batches')
export class BatchController {
  constructor(private readonly batches: BatchService) {}

  /** Oldest first — this is the FEFO picking order, not a list by arrival. */
  @Get()
  list(@Param('offerId') offerId: string) {
    return this.batches.forOffer(offerId);
  }

  @Post()
  receive(@Param('offerId') offerId: string, @Body() dto: ReceiveBatchDto) {
    return this.batches.receive({
      vendorOfferId: offerId,
      batchNo: dto.batchNo,
      quantity: dto.quantity,
      mfgDate: dto.mfgDate ?? null,
      expiryDate: dto.expiryDate ?? null,
    });
  }
}

/**
 * The shelf-life sweep (§1.7.3).
 *
 * Driven by Cloud Scheduler, because shelf life passes with the clock rather
 * than with anything a person does — a batch that was fine last night is not
 * fine this morning, and nobody logs in to notice.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('internal/shelf-life-sweep')
export class ShelfLifeSweepController {
  constructor(private readonly batches: BatchService) {}

  @Post()
  run() {
    return this.batches.delistShortDated();
  }
}
