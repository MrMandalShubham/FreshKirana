/**
 * Applies a PATCH body onto an existing row, ignoring absent fields.
 *
 * ## Why this exists
 *
 * `{ ...existing, ...dto }` looks like it does this, and does not. Under
 * ES2022 class fields — which this codebase targets — a declaration like
 *
 * ```ts
 * class UpdateBranchDto {
 *   @IsOptional() fssaiLicenceNo?: string;
 * }
 * ```
 *
 * emits `Object.defineProperty(this, 'fssaiLicenceNo', { value: undefined })`.
 * So *every* declared field is an own property of the instance whether or not
 * the caller sent it, and spreading the DTO overwrites the stored value with
 * `undefined`.
 *
 * The write itself was never affected — Drizzle skips undefined in `.set()` —
 * but the **validation** ran against the wiped object, so a rule like "a branch
 * cannot be ACTIVE without an FSSAI licence" rejected branches that had one.
 * `PATCH { status: 'ACTIVE' }` was unsatisfiable: the one field you did not
 * send was the one being checked.
 *
 * Use this anywhere a partial update is validated against the merged result.
 */
export function applyPatch<T extends object>(existing: T, patch: object): T {
  const merged = { ...existing } as Record<string, unknown>;

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }

  return merged as T;
}
