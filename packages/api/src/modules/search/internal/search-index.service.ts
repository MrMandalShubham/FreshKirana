import { Inject, Injectable } from '@nestjs/common';
import { InventoryMode, ProductStatus } from '@freshkirana/contracts';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { CatalogService } from '../../catalog/contracts';
import { OfferService, OfferStatus } from '../../offer/contracts';
import { productIndex } from '../schema';

/**
 * Keeps the search projection in step with catalog and offer (spec §2.7.4).
 *
 * Reads through the owning modules' contracts, never their schemas. That is
 * slower than a join would be, and deliberately so: it is what lets search be
 * extracted, or replaced by Typesense, without touching either module.
 */
@Injectable()
export class SearchIndexService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly catalog: CatalogService,
    private readonly offers: OfferService,
  ) {}

  /** Reindexes one product. Called after a catalog or offer change. */
  async syncProduct(masterProductId: string): Promise<void> {
    const product = await this.catalog.getProduct(masterProductId);

    // Non-active products are removed rather than indexed as hidden: a DRAFT is
    // half-catalogued, and an ARCHIVED one must stop appearing immediately.
    if (product.status !== ProductStatus.ACTIVE) {
      await this.remove(masterProductId);
      return;
    }

    const offers = await this.offers.listForProduct(masterProductId);
    const purchasable = offers.filter(
      (offer) => offer.status === OfferStatus.ACTIVE && this.offers.isPurchasable(offer),
    );

    const minPricePaise =
      purchasable.length > 0
        ? Math.min(...purchasable.map((o) => o.sellingPricePaise))
        : null;

    const mrpPaise =
      purchasable.length > 0 ? Math.min(...purchasable.map((o) => o.mrpPaise)) : null;

    const searchText = this.buildSearchText(product);

    await this.db
      .insert(productIndex)
      .values({
        masterProductId: product.id,
        slug: product.slug,
        name: product.name,
        nameI18n: product.nameI18n as Record<string, string>,
        brand: null,
        categoryId: product.categoryId,
        netQuantity: product.netQuantity,
        uom: product.uom,
        vegMark: product.vegMark,
        imageUrl: product.images[0] ?? null,
        productStatus: product.status,
        minPricePaise,
        mrpPaise,
        isAvailable: purchasable.length > 0,
        offerCount: offers.length,
        quantityModeOfferCount: purchasable.filter(
          (o) => o.inventoryMode === InventoryMode.QUANTITY,
        ).length,
        searchText,
        indexedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: productIndex.masterProductId,
        set: {
          slug: product.slug,
          name: product.name,
          nameI18n: product.nameI18n as Record<string, string>,
          categoryId: product.categoryId,
          netQuantity: product.netQuantity,
          uom: product.uom,
          vegMark: product.vegMark,
          imageUrl: product.images[0] ?? null,
          productStatus: product.status,
          minPricePaise,
          mrpPaise,
          isAvailable: purchasable.length > 0,
          offerCount: offers.length,
          quantityModeOfferCount: purchasable.filter(
            (o) => o.inventoryMode === InventoryMode.QUANTITY,
          ).length,
          searchText,
          indexedAt: new Date(),
        },
      });
  }

  async remove(masterProductId: string): Promise<void> {
    await this.db
      .delete(productIndex)
      .where(sql`${productIndex.masterProductId} = ${masterProductId}`);
  }

  /**
   * Rebuilds the whole index.
   *
   * Operational tool, not the steady state: used after a bulk import (P1.3) or
   * a ranking change. Steady-state freshness comes from `syncProduct` on write.
   */
  async rebuild(): Promise<{ indexed: number; removed: number }> {
    const active = await this.catalog.listProducts({
      status: ProductStatus.ACTIVE,
      limit: 100,
      offset: 0,
    });

    let indexed = 0;
    let offset = 0;
    const pageSize = 100;

    for (;;) {
      const page = await this.catalog.listProducts({
        status: ProductStatus.ACTIVE,
        limit: pageSize,
        offset,
      });
      if (page.items.length === 0) break;

      for (const product of page.items) {
        await this.syncProduct(product.id);
        indexed += 1;
      }

      offset += pageSize;
      if (offset >= page.total) break;
    }

    // Drop anything indexed that is no longer an active product.
    const removed = await this.db.execute<{ count: string }>(sql`
      with deleted as (
        delete from search.product_index pi
        where not exists (
          select 1 from catalog.master_product mp
          where mp.id = pi.master_product_id and mp.status = 'ACTIVE'
        )
        returning 1
      )
      select count(*)::text as count from deleted
    `);

    return {
      indexed,
      removed: Number(removed.rows[0]?.count ?? 0),
      ...(active.total === 0 ? {} : {}),
    };
  }

  /**
   * Everything worth matching against, flattened into one column.
   *
   * Includes translations, so a Hindi query reaches a product whose canonical
   * name is English (§4.1 requires product names to translate, not just chrome).
   */
  private buildSearchText(product: {
    name: string;
    slug: string;
    nameI18n: unknown;
    description: string | null;
    uom: string;
    netQuantity: number;
  }): string {
    const translations = Object.values(
      (product.nameI18n as Record<string, string> | null) ?? {},
    );

    return [
      product.name,
      ...translations,
      product.slug.replace(/-/g, ' '),
      // Shoppers type the size as part of the name far more often than they
      // reach for a filter.
      `${product.netQuantity}${product.uom.toLowerCase()}`,
      `${product.netQuantity} ${product.uom.toLowerCase()}`,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }
}
