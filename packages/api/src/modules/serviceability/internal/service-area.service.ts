import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type LatLng,
  ServiceAreaMode,
  isPlausiblyInIndia,
  isValidPincode,
} from '@freshkirana/contracts';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../../db/db.module';
import type { Database } from '../../../db';
import { VendorService, VendorStatus } from '../../vendor/contracts';
import { serviceArea, waitlistEntry } from '../schema';

/** A GeoJSON Polygon, as the admin console draws it. */
export interface PolygonGeoJson {
  type: 'Polygon';
  /** Ring of [longitude, latitude] pairs — GeoJSON order, not map order. */
  coordinates: number[][][];
}

export interface ServiceAreaInput {
  mode: string;
  centreLatitude: number;
  centreLongitude: number;
  radiusMeters?: number;
  polygon?: PolygonGeoJson;
  isActive?: boolean;
}

export interface ServiceableStore {
  vendorId: string;
  distanceMeters: number;
}

/**
 * A point in PostGIS `geography`, from a latitude and longitude.
 *
 * Note the argument order: `ST_MakePoint` takes **longitude first**, because it
 * is (x, y). Getting this backwards is the single most common PostGIS bug and
 * it fails silently — every distance is wrong, nothing errors.
 */
const pointOf = (point: LatLng) =>
  sql`ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)::geography`;

@Injectable()
export class ServiceAreaService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly vendors: VendorService,
  ) {}

  /**
   * Sets or replaces a store's service area.
   *
   * Replace rather than append: two areas would mean two answers to "do you
   * deliver here", with no rule for which wins.
   */
  async setForVendor(vendorId: string, input: ServiceAreaInput) {
    await this.vendors.findById(vendorId);
    this.assertPlausibleCoordinates({
      latitude: input.centreLatitude,
      longitude: input.centreLongitude,
    });

    const values = this.toRowValues(vendorId, input);

    await this.db
      .insert(serviceArea)
      .values(values)
      .onConflictDoUpdate({
        target: serviceArea.vendorId,
        set: { ...values, updatedAt: new Date() },
      });

    return this.findForVendor(vendorId);
  }

  async findForVendor(vendorId: string) {
    // The polygon has to come back as GeoJSON: the raw geography column is a
    // binary blob no client can read.
    const rows = await this.db
      .select({
        id: serviceArea.id,
        vendorId: serviceArea.vendorId,
        mode: serviceArea.mode,
        centreLatitude: serviceArea.centreLatitude,
        centreLongitude: serviceArea.centreLongitude,
        radiusMeters: serviceArea.radiusMeters,
        isActive: serviceArea.isActive,
        polygon: sql<string | null>`ST_AsGeoJSON(${serviceArea.polygon})`,
      })
      .from(serviceArea)
      .where(eq(serviceArea.vendorId, vendorId))
      .limit(1);

    const found = rows[0];
    if (!found) throw new NotFoundException(`Vendor ${vendorId} has no service area`);

    return {
      ...found,
      polygon: found.polygon ? (JSON.parse(found.polygon) as PolygonGeoJson) : null,
    };
  }

  /**
   * Which stores will deliver to this point, nearest first (spec §2.8.1).
   *
   * §2.8.1 also ranks by catalog coverage of the customer's usual basket and by
   * vendor quality score. Neither exists yet — the usual basket arrives with
   * P2.7 and SLA scores with P6.3 — so this ranks by distance alone and the
   * signature is shaped to take more later.
   */
  async resolveStores(point: LatLng, limit = 10): Promise<ServiceableStore[]> {
    this.assertPlausibleCoordinates(point);

    const here = pointOf(point);
    const centre = sql`ST_SetSRID(ST_MakePoint(${serviceArea.centreLongitude}, ${serviceArea.centreLatitude}), 4326)::geography`;

    const rows = await this.db
      .select({
        vendorId: serviceArea.vendorId,
        distanceMeters: sql<number>`ST_Distance(${here}, ${centre})`,
      })
      .from(serviceArea)
      .where(
        sql`${serviceArea.isActive}
            and (
              (${serviceArea.mode} = 'POLYGON' and ST_Covers(${serviceArea.polygon}, ${here}))
              or (${serviceArea.mode} = 'RADIUS' and ST_DWithin(${centre}, ${here}, ${serviceArea.radiusMeters}))
            )`,
      )
      .orderBy(sql`ST_Distance(${here}, ${centre})`)
      // Over-fetch, because the vendor-status filter below removes rows. Cutting
      // to `limit` in SQL first would let a handful of suspended stores squeeze
      // out open ones that are genuinely nearby — the shopper would be told the
      // area is thin when it is not.
      .limit(Math.min(limit * 5, 200));

    // A store that is suspended or still pending approval must not be offered,
    // however close it is. Checked through the vendor module's contract rather
    // than by joining its schema (§2.1.1).
    const serviceable: ServiceableStore[] = [];
    for (const row of rows) {
      if (serviceable.length >= limit) break;

      const vendor = await this.vendors.findById(row.vendorId).catch(() => null);
      if (vendor?.status !== VendorStatus.ACTIVE) continue;
      serviceable.push({
        vendorId: row.vendorId,
        distanceMeters: Math.round(Number(row.distanceMeters)),
      });
    }

    return serviceable;
  }

  async isServiceable(point: LatLng): Promise<boolean> {
    const stores = await this.resolveStores(point, 1);
    return stores.length > 0;
  }

  /**
   * Records demand we cannot serve yet (§2.8.1, §1.11).
   *
   * This is the primary input to expansion decisions, so it is captured without
   * an account — the entire point is that this person cannot become a customer
   * yet, and demanding a signup first would lose exactly the signal we want.
   */
  async joinWaitlist(input: {
    latitude: number;
    longitude: number;
    pincode: string;
    city?: string;
    contactPhone?: string;
    accountId?: string | null;
  }) {
    this.assertPlausibleCoordinates(input);

    if (!isValidPincode(input.pincode)) {
      throw new BadRequestException('pincode must be six digits');
    }

    const rows = await this.db
      .insert(waitlistEntry)
      .values({ ...input, accountId: input.accountId ?? null })
      .returning();

    return rows[0]!;
  }

  /** Where demand is piling up, most-wanted first. Feeds §1.11 expansion. */
  async waitlistByPincode(limit = 50) {
    return this.db
      .select({
        pincode: waitlistEntry.pincode,
        requests: sql<number>`count(*)::int`,
      })
      .from(waitlistEntry)
      .groupBy(waitlistEntry.pincode)
      .orderBy(sql`count(*) desc`)
      .limit(limit);
  }

  private toRowValues(vendorId: string, input: ServiceAreaInput) {
    const mode = input.mode;

    if (mode === ServiceAreaMode.POLYGON) {
      if (!input.polygon) {
        throw new BadRequestException('A POLYGON service area needs a polygon');
      }
      this.assertClosedRing(input.polygon);

      return {
        vendorId,
        mode,
        centreLatitude: input.centreLatitude,
        centreLongitude: input.centreLongitude,
        radiusMeters: input.radiusMeters ?? null,
        isActive: input.isActive ?? true,
        polygon: sql`ST_GeomFromGeoJSON(${JSON.stringify(input.polygon)})::geography`,
      };
    }

    if (!input.radiusMeters || input.radiusMeters <= 0) {
      throw new BadRequestException(
        'A RADIUS service area needs a positive radiusMeters',
      );
    }

    return {
      vendorId,
      mode: ServiceAreaMode.RADIUS,
      centreLatitude: input.centreLatitude,
      centreLongitude: input.centreLongitude,
      radiusMeters: input.radiusMeters,
      isActive: input.isActive ?? true,
      polygon: null,
    };
  }

  /**
   * GeoJSON requires a polygon ring to close — first point equal to last.
   *
   * PostGIS rejects an unclosed ring with a message about the geometry that
   * means nothing to whoever drew the shape, so it is worth catching here and
   * saying what is actually wrong.
   */
  private assertClosedRing(polygon: PolygonGeoJson): void {
    const ring = polygon.coordinates?.[0];
    if (!ring || ring.length < 4) {
      throw new BadRequestException(
        'A polygon needs at least four points, the last repeating the first',
      );
    }

    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new BadRequestException(
        'The polygon ring must close: the last point must equal the first',
      );
    }

    for (const [longitude, latitude] of ring) {
      this.assertPlausibleCoordinates({ latitude: latitude!, longitude: longitude! });
    }
  }

  private assertPlausibleCoordinates(point: LatLng): void {
    if (!isPlausiblyInIndia(point)) {
      throw new BadRequestException(
        'Those coordinates are not in India. Check that latitude and longitude are not swapped — GeoJSON is [longitude, latitude].',
      );
    }
  }
}
