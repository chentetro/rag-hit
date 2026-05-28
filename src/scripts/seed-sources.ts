import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";
import { normalizeUrl } from "../lib/url";

type SeedOptions = {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  requestTimeoutMs: number;
  allowSubdomains: boolean;
};

type QueueItem = {
  url: string;
  depth: number;
};

type SourceType = "page" | "pdf" | "faq";

const SUPABASE_URL =
  (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
    /\/rest\/v1\/?$/,
    "",
  );
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();

  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) continue;
    const key = arg.slice(2, eqIndex);
    const value = arg.slice(eqIndex + 1);
    if (key) map.set(key, value);
  }

  const startUrl = map.get("startUrl") ?? process.env.SEED_START_URL ?? "https://www.hit.ac.il";
  const maxPages = Number(map.get("maxPages") ?? process.env.SEED_MAX_PAGES ?? 50);
  const maxDepth = Number(map.get("maxDepth") ?? process.env.SEED_MAX_DEPTH ?? 4);
  const requestTimeoutMs = Number(map.get("timeoutMs") ?? process.env.SEED_TIMEOUT_MS ?? 15000);
  const allowSubdomains = (map.get("allowSubdomains") ?? process.env.SEED_ALLOW_SUBDOMAINS ?? "false") === "true";

  return { startUrl, maxPages, maxDepth, requestTimeoutMs, allowSubdomains };
}

/**
 * Disallow prefixes are fetched and parsed from the live robots.txt at runtime
 * (see loadRobotsDisallows), so the crawler always honors the current rules
 * instead of a stale in-code snapshot.
 */
let robotsDisallowPrefixes: string[] = [];

function parseRobotsDisallows(robotsTxt: string): string[] {
  const disallows: string[] = [];
  let appliesToOurAgent = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const field = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (field === "user-agent") {
      appliesToOurAgent = value === "*";
    } else if (field === "disallow" && appliesToOurAgent && value) {
      disallows.push(value.toLowerCase());
    }
  }

  return disallows;
}

async function loadRobotsDisallows(origin: string, timeoutMs: number): Promise<string[]> {
  try {
    const robotsUrl = new URL("/robots.txt", origin).toString();
    const response = await fetchWithTimeout(robotsUrl, timeoutMs);
    if (!response.ok) return [];
    const text = await response.text();
    return parseRobotsDisallows(text);
  } catch (err) {
    console.warn(`[ROBOTS] Could not load robots.txt for ${origin}`, err);
    return [];
  }
}

const AUTH_BLOCK_KEYWORDS: readonly string[] = [
  "login",
  "auth",
  "portal",
  "identity",
  "personal",
  "my-hit",
  "myhit",
  "signin",
  "sign-in",
  "sso",
  "oauth",
  "account",
  "profile",
  "dashboard",
];

function isPathBlockedByRobots(pathname: string): boolean {
  return robotsDisallowPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function hasAuthOrPersonalKeyword(value: string): boolean {
  const lower = value.toLowerCase();
  return AUTH_BLOCK_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isSkippableHref(href: string, baseUrl: string): boolean {
  const lowerHref = href.toLowerCase();
  return (
    lowerHref.startsWith("mailto:") ||
    lowerHref.startsWith("tel:") ||
    lowerHref.startsWith("javascript:") ||
    lowerHref.startsWith("#") ||
    (() => {
      const normalized = normalizeUrl(href, baseUrl);
      if (!normalized) return true;

      let candidate: URL;
      try {
        candidate = new URL(normalized);
      } catch {
        return true;
      }

      const pathAndQuery = `${candidate.pathname}${candidate.search}`;
      return (
        isPathBlockedByRobots(candidate.pathname.toLowerCase()) ||
        hasAuthOrPersonalKeyword(pathAndQuery) ||
        hasAuthOrPersonalKeyword(candidate.hostname)
      );
    })()
  );
}

function isLikelyDocumentUrl(url: URL): boolean {
  const p = url.pathname.toLowerCase();
  return [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].some((ext) => p.endsWith(ext));
}

function detectSourceType(url: URL): SourceType {
  const p = url.pathname.toLowerCase();
  if (p.includes("faq")) return "faq";
  if (isLikelyDocumentUrl(url)) return "pdf";
  return "page";
}

function isInternalUrl(candidate: URL, root: URL, allowSubdomains: boolean): boolean {
  if (allowSubdomains) {
    return (
      candidate.hostname === root.hostname ||
      candidate.hostname.endsWith(`.${root.hostname}`)
    );
  }
  return candidate.hostname === root.hostname;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "rag-hit-seeder/1.0 (+seed-sources.ts)",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function upsertSource(row: {
  url: string;
  title: string | null;
  source_type: SourceType;
}): Promise<void> {
  const payload = {
    url: row.url,
    title: row.title,
    source_type: row.source_type,
    // Force immediate eligibility for recrawl-sources first run:
    last_crawled: "1970-01-01T00:00:00.000Z",
  };

  const { error } = await supabase
    .from("sources")
    .upsert(payload, { onConflict: "url" });

  if (error) throw error;
}

async function crawlAndSeed(options: SeedOptions): Promise<void> {
  const startNormalized = normalizeUrl(options.startUrl);
  if (!startNormalized) throw new Error(`Invalid start URL: ${options.startUrl}`);

  const rootUrl = new URL(startNormalized);

  robotsDisallowPrefixes = await loadRobotsDisallows(rootUrl.origin, options.requestTimeoutMs);
  console.log(
    `[ROBOTS] Loaded ${robotsDisallowPrefixes.length} disallow rule(s) from ${rootUrl.origin}/robots.txt`,
  );

  const queue: QueueItem[] = [{ url: startNormalized, depth: 0 }];
  const visited = new Set<string>();

  let discoveredCount = 0;
  let insertedOrUpdatedCount = 0;

  while (queue.length > 0 && visited.size < options.maxPages) {
    const current = queue.shift();
    if (!current) break;

    if (visited.has(current.url)) continue;
    visited.add(current.url);

    let urlObj: URL;
    try {
      urlObj = new URL(current.url);
    } catch {
      continue;
    }

    // Insert source row even if non-HTML, so recrawl script can decide what to do later.
    await upsertSource({
      url: current.url,
      title: null,
      source_type: detectSourceType(urlObj),
    });
    insertedOrUpdatedCount += 1;

    // Don’t expand beyond maxDepth
    if (current.depth >= options.maxDepth) continue;

    // For non-page docs, we don't parse outgoing links
    if (isLikelyDocumentUrl(urlObj)) continue;

    let response: Response;
    try {
      response = await fetchWithTimeout(current.url, options.requestTimeoutMs);
    } catch (err) {
      console.warn(`[FETCH FAIL] ${current.url}`, err);
      continue;
    }

    if (!response.ok) {
      console.warn(`[HTTP ${response.status}] ${current.url}`);
      continue;
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html")) continue;

    const html = await response.text();
    const $ = cheerio.load(html);

    // Optional title update — keep the originally detected source_type so we
    // don't downgrade e.g. an "faq" URL back to "page".
    const pageTitle = $("title").first().text().trim() || null;
    if (pageTitle) {
      await upsertSource({
        url: current.url,
        title: pageTitle,
        source_type: detectSourceType(urlObj),
      });
    }

    $("a[href]").each((_, el) => {
      const href = ($(el).attr("href") ?? "").trim();
      if (!href || isSkippableHref(href, current.url)) return;

      const normalized = normalizeUrl(href, current.url);
      if (!normalized) return;

      let nextUrl: URL;
      try {
        nextUrl = new URL(normalized);
      } catch {
        return;
      }

      if (!isInternalUrl(nextUrl, rootUrl, options.allowSubdomains)) return;
      if (visited.has(normalized)) return;

      queue.push({ url: normalized, depth: current.depth + 1 });
      discoveredCount += 1;
    });

    if (visited.size % 25 === 0) {
      console.log(
        `[PROGRESS] visited=${visited.size}, queue=${queue.length}, discovered=${discoveredCount}, upserts=${insertedOrUpdatedCount}`,
      );
    }
  }

  console.log("Seed complete.");
  console.log(`Visited pages: ${visited.size}`);
  console.log(`Discovered links: ${discoveredCount}`);
  console.log(`Upserted sources: ${insertedOrUpdatedCount}`);
}

async function main(): Promise<void> {
  const options = parseArgs();
  console.log("Starting seed with options:", options);
  await crawlAndSeed(options);
}

main().catch((err) => {
  console.error("Fatal seed error:", err);
  process.exit(1);
});