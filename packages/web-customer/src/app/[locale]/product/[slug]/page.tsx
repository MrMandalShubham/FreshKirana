import { notFound } from 'next/navigation';
import {
  Money,
  UOM_LABEL,
  type Uom,
  gstRateBpToPercent,
  pricePerBaseUnit,
} from '@freshkirana/contracts';
import { AddToCart } from '@/components/AddToCart';
import { BottomNav, Header } from '@/components/Chrome';
import { VegBadge, formatQuantity } from '@/components/ProductCard';
import { fetchProduct, fetchProductAvailability } from '@/lib/api';
import { type Locale, getDictionary, localisedName } from '@/i18n/dictionaries';

/** Per-request: the price shown must be the price charged. */
export const dynamic = 'force-dynamic';

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = getDictionary(locale);

  // Two sources by design: catalog owns the product and its declarations,
  // search owns live price and availability. Composing them here is what a
  // server component is for (§2.4 BFF).
  const [product, availability] = await Promise.all([
    fetchProduct(slug),
    fetchProductAvailability(slug),
  ]);

  if (!product) notFound();

  const price = availability?.minPricePaise ?? null;
  const mrp = availability?.mrpPaise ?? null;
  const unitPrice =
    price != null
      ? pricePerBaseUnit(price, product.netQuantity, product.uom as Uom)
      : null;

  return (
    <>
      <Header locale={locale} />

      <main id="main" className="container">
        <div className="price-row" style={{ marginTop: 16 }}>
          <VegBadge mark={product.vegMark} locale={locale} />
          {availability?.isAvailable === false && (
            <span className="badge out">{t.outOfStock}</span>
          )}
        </div>

        <h1 className="pdp-title">
          {localisedName(product.name, product.nameI18n, locale)}
        </h1>
        <div className="product-qty">
          {formatQuantity(product.netQuantity, product.uom)}
        </div>

        {price != null ? (
          <>
            <div className="price-row" style={{ marginTop: 12 }}>
              <span className="price" style={{ fontSize: 24 }}>
                {Money.formatINR(price as never)}
              </span>
              {mrp != null && mrp > price && (
                <span className="price-mrp">{Money.formatINR(mrp as never)}</span>
              )}
            </div>
            {unitPrice && (
              <div className="price-unit">
                {Money.formatINR(unitPrice.pricePaise as never)} {t.perUnit}{' '}
                {UOM_LABEL[unitPrice.unit]}
              </div>
            )}
          </>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            {t.outOfStock}
          </p>
        )}

        {/*
          Variable-weight notice, shown BEFORE any add-to-cart action (§1.7.1).
          A shopper must know the final price moves with the delivered weight
          before they commit, not when the charge differs from the estimate.
        */}
        {product.isVariableWeight && <p className="notice">{t.variableWeightNotice}</p>}

        {/*
          The add button comes after the variable-weight notice on purpose: a
          shopper must know the final price moves with the delivered weight
          *before* they commit (§1.7.1), not when the charge differs.

          `bestOfferId` is the cheapest purchasable offer, decided by the same
          §2.7.3 rule that produced the price above — so the button adds the
          thing whose price is on screen.
        */}
        {availability?.bestOfferId && availability.isAvailable && (
          <AddToCart vendorOfferId={availability.bestOfferId} locale={locale} />
        )}

        {product.description && (
          <section className="section">
            <p>{product.description}</p>
          </section>
        )}

        {/*
          Legal Metrology declarations (§3.7.3). These are a listing requirement
          for pre-packaged goods, which is why they are rendered here rather
          than tucked behind a tab.
        */}
        <section className="section" aria-labelledby="details">
          <h2 className="section-title" id="details">
            {t.productDetails}
          </h2>

          <dl className="declarations">
            <div>
              <dt>{t.netQuantity}</dt>
              <dd>{formatQuantity(product.netQuantity, product.uom)}</dd>
            </div>

            {product.isPrepackaged && product.manufacturerPacker && (
              <div>
                <dt>{t.manufacturer}</dt>
                <dd>{product.manufacturerPacker}</dd>
              </div>
            )}

            {product.isPrepackaged && product.countryOfOrigin && (
              <div>
                <dt>{t.countryOfOrigin}</dt>
                <dd>{product.countryOfOrigin}</dd>
              </div>
            )}

            {product.isPrepackaged && product.consumerCareContact && (
              <div>
                <dt>{t.consumerCare}</dt>
                <dd>{product.consumerCareContact}</dd>
              </div>
            )}

            <div>
              <dt>{t.hsnCode}</dt>
              <dd>
                {product.hsnCode} · GST {gstRateBpToPercent(product.gstRateBp)}%
              </dd>
            </div>
          </dl>
        </section>

        <button className="button" style={{ width: '100%' }} disabled>
          {t.addToCart} — {t.comingSoon}
        </button>
      </main>

      <BottomNav locale={locale} current="home" />
    </>
  );
}
