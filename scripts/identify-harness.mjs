/*
 * F-03 accuracy harness — the spike's measurement engine.
 *
 * Drives the auth-gated `/api/identify` route over a labeled shelf sample and emits the
 * guardrail report: accuracy-when-answered (the FR-005 ≥90% pass/fail), abstain rate,
 * latency p50/p95 (10s-p95 NFR), and an angled-vs-straight accuracy split.
 *
 * Plain Node ESM, dev-only — runs over HTTP against a local `npm run dev` (workerd) instance
 * so the route gets real `astro:env/server` secrets + the IGDB KV binding without re-implementing
 * the runtime. Native deps (sharp) are fine here; this never touches workerd.
 *
 * Usage:
 *   1. `npm run dev` in another terminal (route needs live OPENROUTER + TWITCH creds, KV binding).
 *   2. Sign-in creds for a dev account: HARNESS_EMAIL / HARNESS_PASSWORD (env).
 *   3. Drop photos + labels.csv into fixtures/shelf/ (see fixtures/shelf/README.md).
 *   4. `npm run harness`
 *
 * Env knobs: HARNESS_BASE_URL (default http://localhost:4321), HARNESS_EMAIL, HARNESS_PASSWORD.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const BASE_URL = process.env.HARNESS_BASE_URL ?? "http://localhost:4321";
const EMAIL = process.env.HARNESS_EMAIL;
const PASSWORD = process.env.HARNESS_PASSWORD;

const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "shelf");
const LABELS_PATH = path.join(FIXTURES_DIR, "labels.csv");
const REPORT_PATH = path.join(FIXTURES_DIR, "report.json");

const DOWNSCALE_LONG_EDGE = 1024; // ~mobile-sized payload; keeps base64 small and latency realistic
const ACCURACY_BAR = 0.9; // FR-005 guardrail
const LATENCY_P95_BUDGET_MS = 10_000; // NFR (server+model figure; excludes the real phone→Worker leg)

// --- Platform normalization (mirrors src/lib/services/igdb.ts so scoring matches grounding) ---
// Duplicated here on purpose: the harness is throwaway dev tooling and cannot import the TS service.
// Keep in sync with PLATFORM_IDS_BY_NAME / normalizePlatform in igdb.ts if that map grows.

const PLATFORM_IDS_BY_NAME = new Map([
  ["pc", [6]],
  ["windows", [6]],
  ["microsoft windows", [6]],
  ["ps5", [167]],
  ["playstation 5", [167]],
  ["ps4", [48]],
  ["playstation 4", [48]],
  ["ps3", [9]],
  ["playstation 3", [9]],
  ["ps2", [8]],
  ["playstation 2", [8]],
  ["ps vita", [46]],
  ["psvita", [46]],
  ["playstation vita", [46]],
  ["psp", [38]],
  ["playstation portable", [38]],
  ["switch 2", [508]],
  ["nintendo switch 2", [508]],
  ["switch", [130]],
  ["nintendo switch", [130]],
  ["wii u", [41]],
  ["wii", [5]],
  ["nintendo 3ds", [37]],
  ["3ds", [37]],
  ["nintendo ds", [20]],
  ["xbox series x", [169]],
  ["xbox series s", [169]],
  ["xbox series x|s", [169]],
  ["xbox series x/s", [169]],
  ["xbox series", [169]],
  ["xbox one", [49]],
  ["xbox 360", [12]],
]);

function normalizePlatform(platform) {
  return platform.trim().toLowerCase().replace(/\s+/g, " ");
}

// Mirrors resolvePlatformIds in igdb.ts: parentheticals + separators split a multi-platform
// string into parts whose recognized ids are unioned.
const PLATFORM_PART_SEPARATORS = /[•/,|()]/;

function resolvePlatformIds(platform) {
  const normalized = normalizePlatform(platform);
  const direct = PLATFORM_IDS_BY_NAME.get(normalized);
  if (direct) return direct;

  const ids = new Set();
  for (const part of normalized.split(PLATFORM_PART_SEPARATORS)) {
    const partIds = PLATFORM_IDS_BY_NAME.get(normalizePlatform(part));
    if (partIds) for (const id of partIds) ids.add(id);
  }
  return [...ids];
}

/**
 * True when two free-text platforms refer to the same console. Prefers IGDB id-set *overlap*
 * (so "PS5" === "PlayStation 5", "Xbox Series X • Xbox One" overlaps "Xbox Series X", and
 * "PSVita" === "PlayStation Vita"), falling back to normalized-string equality for platforms
 * not in the map. Mirrors platformsOverlap in igdb.ts.
 */
function platformsMatch(a, b) {
  const idsA = resolvePlatformIds(a);
  const idsB = resolvePlatformIds(b);
  if (idsA.length > 0 && idsB.length > 0) {
    const setB = new Set(idsB);
    return idsA.some((id) => setB.has(id));
  }
  return normalizePlatform(a) === normalizePlatform(b);
}

// --- Minimal CSV parsing (quoted-field aware) ---

function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((c) => c.trim() !== "")) rows.push(record);
      record = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    if (record.some((c) => c.trim() !== "")) rows.push(record);
  }
  return rows;
}

function loadLabels(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("labels.csv is empty");
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  for (const required of ["filename", "true_title", "true_platform", "angled"]) {
    if (idx(required) === -1) throw new Error(`labels.csv missing required column: ${required}`);
  }
  const igdbIdx = idx("true_igdb_id");
  return rows.slice(1).map((cols) => {
    const trueIgdbRaw = igdbIdx === -1 ? "" : (cols[igdbIdx] ?? "").trim();
    return {
      filename: (cols[idx("filename")] ?? "").trim(),
      trueTitle: (cols[idx("true_title")] ?? "").trim(),
      truePlatform: (cols[idx("true_platform")] ?? "").trim(),
      angled: (cols[idx("angled")] ?? "").trim() === "1",
      trueIgdbId: trueIgdbRaw === "" ? null : Number(trueIgdbRaw),
    };
  });
}

// --- HTTP helpers ---

/** Sign in through the real auth route and capture the Supabase session cookies. */
async function authenticate() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Set HARNESS_EMAIL and HARNESS_PASSWORD (dev account) before running the harness.");
  }
  const body = new FormData();
  body.append("email", EMAIL);
  body.append("password", PASSWORD);

  // `Origin` must match the host: Astro's CSRF protection (security.checkOrigin, on by default)
  // 403s same-site form POSTs that arrive without a matching Origin (Node fetch sends none).
  const res = await fetch(`${BASE_URL}/api/auth/signin`, {
    method: "POST",
    body,
    headers: { origin: BASE_URL },
    redirect: "manual",
  });
  // signin redirects to "/" on success (cookies set) or to /auth/signin?error=... on failure.
  const location = res.headers.get("location") ?? "";
  if (location.includes("error=")) {
    throw new Error(`Sign-in failed: ${decodeURIComponent(location.split("error=")[1] ?? "")}`);
  }
  const setCookies = res.headers.getSetCookie();
  if (setCookies.length === 0) {
    throw new Error(`Sign-in returned no session cookies (status ${res.status}). Is the dev account valid?`);
  }
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

/** Resolve the truth IGDB id for a label: pinned value wins, else ground via the GET shortcut. */
async function resolveTruthId(label, cookie) {
  if (label.trueIgdbId != null && !Number.isNaN(label.trueIgdbId)) return label.trueIgdbId;
  const qs = new URLSearchParams({ title: label.trueTitle, platform: label.truePlatform });
  const res = await fetch(`${BASE_URL}/api/identify?${qs.toString()}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`Truth grounding failed for "${label.trueTitle}" (status ${res.status})`);
  const data = await res.json();
  return data.igdbId ?? null;
}

/** Downscale to the long edge, POST as multipart, return the route response + wall-clock latency. */
async function identifyPhoto(filePath, cookie) {
  const jpeg = await sharp(filePath)
    .rotate() // honor EXIF orientation before resizing
    .resize(DOWNSCALE_LONG_EDGE, DOWNSCALE_LONG_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const body = new FormData();
  body.append("photo", new Blob([jpeg], { type: "image/jpeg" }), "photo.jpg");

  const startedAt = Date.now();
  const res = await fetch(`${BASE_URL}/api/identify`, {
    method: "POST",
    body,
    headers: { cookie, origin: BASE_URL },
  });
  const latencyMs = Date.now() - startedAt;
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`/api/identify POST failed (status ${res.status}): ${errBody}`);
  }
  return { result: await res.json(), latencyMs };
}

// --- Aggregation ---

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedMs.length) - 1;
  return sortedMs[Math.min(Math.max(rank, 0), sortedMs.length - 1)];
}

function accuracyOf(rows) {
  const answered = rows.filter((r) => r.answered);
  const correct = answered.filter((r) => r.correct);
  return {
    answered: answered.length,
    correct: correct.length,
    accuracy: answered.length === 0 ? null : correct.length / answered.length,
  };
}

function pct(value) {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

// --- Main ---

async function main() {
  let labelsText;
  try {
    labelsText = await readFile(LABELS_PATH, "utf8");
  } catch {
    throw new Error(`No labels.csv at ${LABELS_PATH} — see fixtures/shelf/README.md.`);
  }
  const labels = loadLabels(labelsText);
  if (labels.length === 0) throw new Error("labels.csv has a header but no data rows.");

  console.log(`Harness: ${labels.length} labeled photo(s) against ${BASE_URL}`);
  const cookie = await authenticate();
  console.log("Authenticated.\n");

  const rows = [];
  for (const label of labels) {
    const filePath = path.join(FIXTURES_DIR, label.filename);
    try {
      const truthId = await resolveTruthId(label, cookie);
      const { result, latencyMs } = await identifyPhoto(filePath, cookie);

      const identified = result.status === "identified";
      const proposedId = identified ? result.igdbId : null;
      const answered = identified && proposedId != null;
      const correct =
        answered && truthId != null && proposedId === truthId && platformsMatch(result.platform, label.truePlatform);

      rows.push({ ...label, truthId, result, latencyMs, answered, correct, proposedId });

      const verdict = answered ? (correct ? "✓ correct" : "✗ wrong") : "– abstain";
      const proposed = identified ? `${result.title} / ${result.platform} (id ${proposedId ?? "—"})` : result.status;
      console.log(
        `${verdict.padEnd(10)} ${label.filename}\n` +
          `   truth:    ${label.trueTitle} / ${label.truePlatform} (id ${truthId ?? "—"})\n` +
          `   proposed: ${proposed}\n` +
          `   latency:  ${latencyMs} ms${label.angled ? "  [angled]" : ""}\n`,
      );
    } catch (err) {
      console.error(`! error on ${label.filename}: ${err.message}\n`);
      rows.push({
        ...label,
        truthId: null,
        result: { status: "error" },
        latencyMs: null,
        answered: false,
        correct: false,
        proposedId: null,
      });
    }
  }

  // Aggregate
  const overall = accuracyOf(rows);
  const abstained = rows.filter((r) => !r.answered).length;
  const latencies = rows
    .filter((r) => r.latencyMs != null)
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const angled = accuracyOf(rows.filter((r) => r.angled));
  const straight = accuracyOf(rows.filter((r) => !r.angled));

  const accuracyPass = overall.accuracy != null && overall.accuracy >= ACCURACY_BAR;
  const latencyPass = p95 != null && p95 <= LATENCY_P95_BUDGET_MS;

  const report = {
    baseUrl: BASE_URL,
    total: rows.length,
    accuracyWhenAnswered: { ...overall, bar: ACCURACY_BAR, pass: accuracyPass },
    abstain: { count: abstained, rate: rows.length === 0 ? null : abstained / rows.length },
    latencyMs: { p50, p95, budget: LATENCY_P95_BUDGET_MS, pass: latencyPass },
    angledBreakdown: { angled, straight },
    rows: rows.map((r) => ({
      filename: r.filename,
      angled: r.angled,
      truthId: r.truthId,
      proposedId: r.proposedId,
      status: r.result.status,
      answered: r.answered,
      correct: r.correct,
      latencyMs: r.latencyMs,
    })),
  };

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

  // Console summary
  console.log("──────────────────────────────────────────────");
  console.log("SUMMARY");
  console.log(
    `  accuracy-when-answered: ${pct(overall.accuracy)} (${overall.correct}/${overall.answered})  ` +
      `bar ≥${pct(ACCURACY_BAR)} → ${accuracyPass ? "PASS" : "FAIL"}`,
  );
  console.log(`  abstain rate:           ${pct(report.abstain.rate)} (${abstained}/${rows.length})`);
  console.log(
    `  latency p50 / p95:      ${p50 ?? "n/a"} / ${p95 ?? "n/a"} ms  ` +
      `budget p95 ≤${LATENCY_P95_BUDGET_MS} ms → ${latencyPass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `  angled vs straight:     ${pct(angled.accuracy)} (${angled.correct}/${angled.answered})  vs  ` +
      `${pct(straight.accuracy)} (${straight.correct}/${straight.answered})`,
  );
  console.log(`\n  report written → ${REPORT_PATH}`);
  console.log("  note: p95 is the server+model figure; it excludes the real phone→Worker uplink.");
  console.log("──────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(`\nHarness aborted: ${err.message}`);
  process.exitCode = 1;
});
