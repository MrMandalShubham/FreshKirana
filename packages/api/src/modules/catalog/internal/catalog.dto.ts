import {
  GST_RATE_BP,
  ProductStatus,
  Uom,
  PricingUom,
  VegMark,
  isValidEan,
  isValidHsnCode,
} from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@ValidatorConstraint({ name: 'hsnCode' })
export class HsnCodeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isValidHsnCode(value);
  }
  defaultMessage(): string {
    return 'hsnCode must be 4, 6 or 8 digits';
  }
}

@ValidatorConstraint({ name: 'ean' })
export class EanConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && isValidEan(value))
    );
  }
  defaultMessage(): string {
    return 'eanBarcode must be 8, 12 or 13 digits';
  }
}

export class CreateCategoryDto {
  @Matches(SLUG, { message: 'slug must be lowercase kebab-case' })
  @MaxLength(100)
  slug!: string;

  @IsString() @MinLength(1) @MaxLength(200) name!: string;

  @IsOptional() @IsObject() nameI18n?: Record<string, string>;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
}

export class CreateBrandDto {
  @Matches(SLUG, { message: 'slug must be lowercase kebab-case' })
  @MaxLength(100)
  slug!: string;

  @IsString() @MinLength(1) @MaxLength(200) name!: string;
}

export class CreateProductDto {
  @Matches(SLUG, { message: 'slug must be lowercase kebab-case' })
  @MaxLength(200)
  slug!: string;

  @IsString() @MinLength(1) @MaxLength(300) name!: string;
  @IsOptional() @IsObject() nameI18n?: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;

  @IsString() categoryId!: string;
  @IsOptional() @IsString() brandId?: string;

  /** Whole number in `uom`: 500 G, 5 KG. Never fractional — see schema.ts. */
  @IsInt() @Min(1) netQuantity!: number;
  @IsIn(Object.values(Uom)) uom!: Uom;

  @IsOptional() @IsBoolean() isVariableWeight?: boolean;
  @IsOptional() @IsIn(Object.values(PricingUom)) pricingUom?: PricingUom;
  @IsOptional() @IsInt() @Min(0) @Max(50) weightTolerancePct?: number;

  /** Governs whether the Legal Metrology declarations are mandatory (§3.7.3). */
  @IsOptional() @IsBoolean() isPrepackaged?: boolean;

  @IsOptional() @Validate(EanConstraint) eanBarcode?: string;

  @Validate(HsnCodeConstraint) hsnCode!: string;

  /** Basis points: 500 is 5.00%. */
  @IsInt() @Min(0) @Max(5000) gstRateBp!: number;

  @IsOptional() @IsIn(Object.values(VegMark)) vegMark?: VegMark;

  // Legal Metrology declarations. Optional here, but required by both the
  // service and a database CHECK before the product may become ACTIVE.
  @IsOptional() @IsString() @MaxLength(500) manufacturerPacker?: string;
  @IsOptional() @IsString() @MaxLength(100) countryOfOrigin?: string;
  @IsOptional() @IsString() @MaxLength(300) consumerCareContact?: string;

  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];

  @IsOptional() @IsIn(Object.values(ProductStatus)) status?: ProductStatus;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @IsOptional() @IsObject() nameI18n?: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brandId?: string;
  @IsOptional() @IsInt() @Min(1) netQuantity?: number;
  @IsOptional() @IsIn(Object.values(Uom)) uom?: Uom;
  @IsOptional() @IsBoolean() isVariableWeight?: boolean;
  @IsOptional() @IsIn(Object.values(PricingUom)) pricingUom?: PricingUom;
  @IsOptional() @IsInt() @Min(0) @Max(50) weightTolerancePct?: number;
  @IsOptional() @IsBoolean() isPrepackaged?: boolean;
  @IsOptional() @Validate(EanConstraint) eanBarcode?: string;
  @IsOptional() @Validate(HsnCodeConstraint) hsnCode?: string;
  @IsOptional() @IsInt() @Min(0) @Max(5000) gstRateBp?: number;
  @IsOptional() @IsIn(Object.values(VegMark)) vegMark?: VegMark;
  @IsOptional() @IsString() @MaxLength(500) manufacturerPacker?: string;
  @IsOptional() @IsString() @MaxLength(100) countryOfOrigin?: string;
  @IsOptional() @IsString() @MaxLength(300) consumerCareContact?: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
  @IsOptional() @IsIn(Object.values(ProductStatus)) status?: ProductStatus;
}

export class ListProductsQueryDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsIn(Object.values(ProductStatus)) status?: ProductStatus;
  @IsOptional() @IsString() @MaxLength(200) search?: string;

  // Query strings are always strings. Without @Type the ValidationPipe hands
  // `"5"` to @IsInt and the request 400s - so every paginated endpoint needs
  // this, not just this one.
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export const DEFAULT_GST_RATE_BP = GST_RATE_BP.FIVE;

// ---------------------------------------------------------------------------
// Product requests (§1.9.1)
// ---------------------------------------------------------------------------

export class CreateProductRequestDto {
  @IsString() @MinLength(2) @MaxLength(300) proposedName!: string;

  @IsOptional() @Validate(EanConstraint) proposedEanBarcode?: string;
  @IsOptional() @IsString() @MaxLength(200) proposedBrand?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) proposedNetQuantity?: number;
  @IsOptional() @IsIn(Object.values(Uom)) proposedUom?: Uom;
  @IsOptional() @IsString() @MaxLength(200) categoryHint?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];

  // Captured up front so approval can attach the offer without asking again.
  @IsOptional() @IsInt() @Min(1) desiredMrpPaise?: number;
  @IsOptional() @IsInt() @Min(1) desiredSellingPricePaise?: number;
  @IsOptional() @IsInt() @Min(0) desiredStockOnHand?: number;
}

export class ApproveProductRequestDto {
  @Matches(SLUG, { message: 'slug must be lowercase kebab-case' })
  @MaxLength(200)
  slug!: string;

  @IsString() @MinLength(1) @MaxLength(300) name!: string;
  @IsString() categoryId!: string;

  @IsInt() @Min(1) netQuantity!: number;
  @IsIn(Object.values(Uom)) uom!: Uom;

  @Validate(HsnCodeConstraint) hsnCode!: string;
  @IsInt() @Min(0) @Max(5000) gstRateBp!: number;

  @IsOptional() @Validate(EanConstraint) eanBarcode?: string;
  @IsOptional() @IsBoolean() isPrepackaged?: boolean;
  @IsOptional() @IsString() @MaxLength(500) manufacturerPacker?: string;
  @IsOptional() @IsString() @MaxLength(100) countryOfOrigin?: string;
  @IsOptional() @IsString() @MaxLength(300) consumerCareContact?: string;

  /** Also publish it. Legal Metrology still gates this (§3.7.3). */
  @IsOptional() @IsBoolean() activate?: boolean;
}

export class RejectProductRequestDto {
  @IsString() @MinLength(3) @MaxLength(1000) reviewerNotes!: string;

  /** Set when rejecting as a duplicate, so the branch is pointed at the real one. */
  @IsOptional() @IsString() duplicateOfMasterProductId?: string;
}

export class ImportCatalogDto {
  @IsString() @MinLength(10) csv!: string;
}
