import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ProductStatus } from '@freshkirana/contracts';
import { Public } from '../../identity/contracts';
import { CatalogService } from './catalog.service';

/**
 * Public catalog reads for the storefront (spec §1.5.1, §4.2).
 *
 * Public because browsing precedes signup — requiring a login to see a product
 * would break the top of the funnel. Separate from the admin controller so the
 * public surface is small and obvious: reads only, ACTIVE products only, and no
 * route here can mutate anything.
 */
@Controller('catalog')
export class StorefrontCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('categories')
  categories() {
    return this.catalog.listCategories();
  }

  /**
   * One product by slug, with the Legal Metrology declarations §3.7.3 requires
   * on the listing.
   *
   * DRAFT and ARCHIVED products 404 rather than render: a DRAFT may be missing
   * exactly those declarations, and showing it would be the violation the
   * catalog constraint exists to prevent.
   */
  @Public()
  @Get('products/:slug')
  async product(@Param('slug') slug: string) {
    const product = await this.catalog.findBySlug(slug);
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException(`Product "${slug}" not found`);
    }
    return product;
  }
}
