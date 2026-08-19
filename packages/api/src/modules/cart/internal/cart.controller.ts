import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  AnalyticsEvent,
  type Principal,
  SubstitutionPreference,
} from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AnalyticsService } from '../../analytics/contracts';
import { CurrentUser, Public } from '../../identity/contracts';
import { CartService, type CartOwner } from './cart.service';

export class AddItemDto {
  @IsString() vendorOfferId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) quantity?: number;
}

export class BulkAddItemDto {
  @IsString() vendorOfferId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) quantity?: number;
}

export class AddManyDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BulkAddItemDto)
  items!: BulkAddItemDto[];
}

export class UpdateQuantityDto {
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
}

export class SubstitutionPreferenceDto {
  @IsIn(Object.values(SubstitutionPreference)) preference!: string;
}

/**
 * The shopper's basket (spec §1.5.1, §4.2).
 *
 * `@Public` because a basket exists before signup — browsing precedes an
 * account, and demanding a login to hold items loses the shopper at the top of
 * the funnel. An anonymous basket is identified by `x-cart-token` and claimed
 * by the account on sign-in.
 */
@Controller('cart')
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Public()
  @Get()
  async view(
    @Headers('x-cart-token') cartToken?: string,
    @CurrentUser() principal?: Principal,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const owner = this.ownerFrom(principal, cartToken);
    const view = await this.cart.view(owner);

    void this.analytics.emit(AnalyticsEvent.CART_VIEWED, {
      accountId: principal?.accountId ?? null,
      anonId: cartToken ?? 'anonymous',
      sessionId: sessionId ?? 'unknown',
      properties: {
        lineCount: view.lines.length,
        subtotalPaise: view.totals.subtotalPaise,
        meetsMinimumOrder: view.totals.meetsMinimumOrder,
      },
    });

    return view;
  }

  @Public()
  @Post('items')
  async addItem(
    @Body() dto: AddItemDto,
    @Headers('x-cart-token') cartToken?: string,
    @CurrentUser() principal?: Principal,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const owner = this.ownerFrom(principal, cartToken);
    const view = await this.cart.addItem(owner, dto);

    const line = view.lines.find((l) => l.vendorOfferId === dto.vendorOfferId);

    // Rule R1. `source` is what makes the §0.3 wedge measurable later: without
    // it there is no way to tell a usual-basket add from a search add.
    void this.analytics.emit(AnalyticsEvent.ADD_TO_CART, {
      accountId: principal?.accountId ?? null,
      anonId: cartToken ?? 'anonymous',
      sessionId: sessionId ?? 'unknown',
      properties: {
        masterProductId: line?.masterProductId,
        quantity: line?.quantity,
        lineTotalPaise: line?.lineTotalPaise,
        cartLineCount: view.lines.length,
      },
    });

    return view;
  }

  /**
   * One tap, several items — "add my usual basket" (§0.3, §4.2).
   *
   * Answers 201 even when some items could not be added: the response says what
   * went in and what did not, because a basket that is nine-tenths right is a
   * success the shopper can finish, not a failure.
   */
  @Public()
  @Post('items/bulk')
  async addMany(
    @Body() dto: AddManyDto,
    @Headers('x-cart-token') cartToken?: string,
    @CurrentUser() principal?: Principal,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const owner = this.ownerFrom(principal, cartToken);
    const result = await this.cart.addMany(owner, dto.items);

    // Rule R1. This is the §0.3 wedge's conversion metric: how often a
    // predicted basket is actually taken, and how much of it survives.
    void this.analytics.emit(AnalyticsEvent.USUAL_BASKET_ACCEPTED, {
      accountId: principal?.accountId ?? null,
      anonId: cartToken ?? 'anonymous',
      sessionId: sessionId ?? 'unknown',
      properties: {
        requested: dto.items.length,
        added: result.added.length,
        skipped: result.skipped.length,
      },
    });

    return result;
  }

  @Public()
  @Patch('items/:lineId')
  updateQuantity(
    @Param('lineId') lineId: string,
    @Body() dto: UpdateQuantityDto,
    @Headers('x-cart-token') cartToken?: string,
    @CurrentUser() principal?: Principal,
  ) {
    return this.cart.updateQuantity(
      this.ownerFrom(principal, cartToken),
      lineId,
      dto.quantity,
    );
  }

  @Public()
  @Delete('items/:lineId')
  async removeItem(
    @Param('lineId') lineId: string,
    @Headers('x-cart-token') cartToken?: string,
    @CurrentUser() principal?: Principal,
    @Headers('x-session-id') sessionId?: string,
  ) {
    const owner = this.ownerFrom(principal, cartToken);
    const view = await this.cart.removeItem(owner, lineId);

    void this.analytics.emit(AnalyticsEvent.REMOVE_FROM_CART, {
      accountId: principal?.accountId ?? null,
      anonId: cartToken ?? 'anonymous',
      sessionId: sessionId ?? 'unknown',
      properties: { cartLineCount: view.lines.length },
    });

    return view;
  }

  @Public()
  @Delete()
  clear(
    @Headers('x-cart-token') cartToken?: string,
    @CurrentUser() principal?: Principal,
  ) {
    return this.cart.clear(this.ownerFrom(principal, cartToken));
  }

  @Public()
  @Patch('substitution-preference')
  setSubstitutionPreference(
    @Body() dto: SubstitutionPreferenceDto,
    @Headers('x-cart-token') cartToken?: string,
    @CurrentUser() principal?: Principal,
  ) {
    return this.cart.setSubstitutionPreference(
      this.ownerFrom(principal, cartToken),
      dto.preference,
    );
  }

  /** Claims the anonymous basket for the signed-in account. */
  @Post('claim')
  claim(@Headers('x-cart-token') cartToken: string, @CurrentUser() principal: Principal) {
    return this.cart.claim(cartToken, principal.accountId);
  }

  /**
   * An account always wins over a token.
   *
   * If a signed-in shopper still sends the token their browser kept, using it
   * would leave them shopping into an anonymous basket that their order history
   * never sees.
   */
  private ownerFrom(principal: Principal | undefined, cartToken?: string): CartOwner {
    if (principal?.accountId) return { accountId: principal.accountId };
    return { anonId: cartToken };
  }
}

export class CartTokenHeaderDto {
  @IsOptional() @IsString() @MaxLength(200) token?: string;
}
