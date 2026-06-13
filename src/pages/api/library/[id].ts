import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { EntryNotFoundError, deleteLibraryEntry, updateLibraryEntry } from "@/lib/services/library";
import { patchEntrySchema, updateEntrySchema } from "@/lib/validation/library";

export const prerender = false;

/**
 * PUT /api/library/[id] — full-row, last-write-wins update of a single entry (FR-010).
 *
 * Validates the complete editable field set and writes it as one patch. RLS scopes the write
 * to the current user; a bad or foreign id surfaces as `EntryNotFoundError` → 404.
 */
export const PUT: APIRoute = async ({ request, params, cookies, locals }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  if (!locals.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const id = params.id;
  if (!id) {
    return Response.json({ error: "Missing entry id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateEntrySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const entry = await updateLibraryEntry(supabase, id, parsed.data);
    return Response.json({ entry }, { status: 200 });
  } catch (error) {
    if (error instanceof EntryNotFoundError) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }
    return Response.json({ error: "Failed to update the entry" }, { status: 500 });
  }
};

/**
 * PATCH /api/library/[id] — partial update of a single entry (S-04 inline status change).
 *
 * Mirrors `PUT`'s guards (auth, JSON parse, zod, `EntryNotFoundError` → 404) but validates the
 * lean `patchEntrySchema` and forwards only the provided fields, so an inline status change writes
 * just what it owns instead of resending the full row. `updateLibraryEntry` already does a true
 * partial patch, so the omitted columns are untouched.
 */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  if (!locals.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const id = params.id;
  if (!id) {
    return Response.json({ error: "Missing entry id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchEntrySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const entry = await updateLibraryEntry(supabase, id, parsed.data);
    return Response.json({ entry }, { status: 200 });
  } catch (error) {
    if (error instanceof EntryNotFoundError) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }
    return Response.json({ error: "Failed to update the entry" }, { status: 500 });
  }
};

/**
 * DELETE /api/library/[id] — hard delete behind the UI's confirmation step (FR-011).
 *
 * Returns 204 with no body on success. A no-row delete (bad/foreign id) is a 404, not a
 * misleading success.
 */
export const DELETE: APIRoute = async ({ request, params, cookies, locals }) => {
  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured" }, { status: 500 });
  }

  if (!locals.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const id = params.id;
  if (!id) {
    return Response.json({ error: "Missing entry id" }, { status: 400 });
  }

  try {
    await deleteLibraryEntry(supabase, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof EntryNotFoundError) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }
    return Response.json({ error: "Failed to delete the entry" }, { status: 500 });
  }
};
