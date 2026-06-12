import { z } from "zod";
import type { LibraryEntryUpdate } from "@/types";
import { METADATA_STATUSES, PLAY_STATUSES } from "@/types";

/**
 * Full editable field set for a library entry (FR-010), shared by `PUT /api/library/[id]`.
 *
 * The form sends the complete set and the service writes it as one last-write-wins patch, so
 * this schema is the single contract the form and route agree on. Nullability mirrors the DB
 * columns. String[] fields trim items and drop empties; an empty array stays `[]` (never
 * collapsed to `null`) so "user cleared all chips" is distinguishable and round-trips cleanly.
 * `igdb_id`/`metadata_status` are enrichment-owned — carried through unchanged on a plain save,
 * mutated only by a successful re-fetch.
 *
 * The inferred type is assignable to `LibraryEntryUpdate` (asserted below).
 */

/** Trimmed `string[]`, empties dropped. Used for genre/developer/series. */
const tagArray = z
  .array(z.string())
  .transform((items) => items.map((item) => item.trim()).filter((item) => item.length > 0))
  .nullable();

/** Nullable `YYYY-MM-DD` date string. Empty string normalizes to `null`. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .nullable()
  .or(z.literal("").transform(() => null));

export const updateEntrySchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  platform: z.string().trim().min(1, "platform is required"),
  play_status: z.enum(PLAY_STATUSES),
  play_time_hours: z.number().int().min(0).nullable(),
  date_bought: isoDate,
  genre: tagArray,
  developer: tagArray,
  series: tagArray,
  length_hours: z.number().min(0).nullable(),
  release_year: z.number().int().nullable(),
  release_date: isoDate,
  igdb_id: z.number().nullable(),
  metadata_status: z.enum(METADATA_STATUSES).nullable(),
});

export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;

// Compile-time guarantee that the validated payload is a valid update patch.
const _assignable: (input: UpdateEntryInput) => LibraryEntryUpdate = (input) => input;
void _assignable;

/** Lookup-only request contract for `POST /api/library/lookup`: title + platform, both required. */
export const lookupRequestSchema = z.object({
  title: z.string().trim().min(1, "title is required"),
  platform: z.string().trim().min(1, "platform is required"),
});
