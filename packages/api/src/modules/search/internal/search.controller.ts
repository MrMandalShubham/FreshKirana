import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { type Principal, Role } from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AnalyticsEvent, AnalyticsService } from '../../analytics/contracts';
import { CurrentUser, Public, Roles } from '../../identity/contracts';
import { SearchIndexService } from './search-index.service';
import { SearchService } from './search.service';
import { SynonymKind, SynonymService } from './synonym.service';

export class SearchQueryDto {
  @IsString() @MinLength(1) @MaxLength(200) q!: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(10) locale?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;

  /** Client-side ids so the search event joins the rest of the funnel (§5.1). */
  @IsOptional() @IsString() @MaxLength(200) anonId?: string;
  @IsOptional() @IsString() @MaxLength(200) sessionId?: string;
}

export class CreateSynonymDto {
  @IsString() @MinLength(1) @MaxLength(100) term!: string;
  @IsArray() @IsString({ each: true }) expansions!: string[];
  @IsOptional() @IsString() @MaxLength(10) locale?: string;
  @IsOptional() @IsIn(Object.values(SynonymKind)) kind?: string;
}

export class UpdateSynonymDto {
  @IsBoolean() isActive!: boolean;
}

/**
 * Customer search (spec §1.5.1, §2.7).
 *
 * Public: browsing precedes signup, and requiring a login to search would break
 * the top of the funnel entirely.
 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Public()
  @Get()
  async query(@Query() dto: SearchQueryDto, @CurrentUser() principal?: Principal) {
    const startedAt = process.hrtime.bigint();
    const result = await this.search.search({
      query: dto.q,
      limit: dto.limit,
      offset: dto.offset,
      categoryId: dto.categoryId,
      locale: dto.locale,
    });
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    // Rule R1. The zero-result flag is what feeds the §2.7.4 weekly synonym
    // review — without it, the failing queries are invisible.
    void this.analytics.emit(AnalyticsEvent.SEARCH_PERFORMED, {
      accountId: principal?.accountId ?? null,
      anonId: dto.anonId ?? 'anonymous',
      sessionId: dto.sessionId ?? 'unknown',
      properties: {
        resultCount: result.total,
        zeroResult: result.zeroResult,
        expandedTermCount: result.expandedTerms.length,
        durationMs: Math.round(durationMs),
        hasCorrection: Boolean(result.didYouMean),
      },
    });

    return result;
  }

  @Public()
  @Get('suggest')
  suggest(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.search.suggest(q ?? '', limit ? Number(limit) : undefined);
  }

  /** Category listing (§4.2). A browse, not a search — no query required. */
  @Public()
  @Get('browse')
  browse(
    @Query('categoryId') categoryId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.search.browse({
      categoryId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** Price and availability for one product, by slug. Feeds the PDP. */
  @Public()
  @Get('product/:slug')
  product(@Param('slug') slug: string) {
    return this.search.findBySlug(slug);
  }
}

/**
 * Synonym governance (§2.7.2).
 *
 * Ops-editable **without a deploy** — that is a launch requirement, not an
 * optimisation. The dictionary is grown weekly from failed searches, and
 * waiting on a release to add "dungri" would mean Gujarati shoppers cannot find
 * onions for a fortnight.
 */
@Roles(Role.ADMIN, Role.OPS)
@Controller('admin/search')
export class SearchAdminController {
  constructor(
    private readonly synonyms: SynonymService,
    private readonly index: SearchIndexService,
  ) {}

  @Get('synonyms')
  list(@Query('locale') locale?: string) {
    return this.synonyms.list(locale);
  }

  @Post('synonyms')
  create(@Body() dto: CreateSynonymDto, @CurrentUser() principal: Principal) {
    return this.synonyms.create({ ...dto, createdByAccountId: principal.accountId });
  }

  @Patch('synonyms/:id')
  setActive(@Param('id') id: string, @Body() dto: UpdateSynonymDto) {
    return this.synonyms.setActive(id, dto.isActive);
  }

  @Post('synonyms/seed')
  seed() {
    return this.synonyms.seedDefaults();
  }

  /** Operational tool: after a bulk import (P1.3) or a ranking change. */
  @Post('reindex')
  reindex() {
    return this.index.rebuild();
  }

  @Post('reindex/:masterProductId')
  reindexOne(@Param('masterProductId') masterProductId: string) {
    return this.index.syncProduct(masterProductId);
  }
}
