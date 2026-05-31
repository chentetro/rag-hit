import crypto from "node:crypto";
import * as cheerio from "cheerio";
import { embedMany } from "ai";
import { google } from "@ai-sdk/google";
import { createClient } from "@supabase/supabase-js";

import { splitIntoChunks } from "../lib/chunker";
import { normalizeUrl } from "../lib/url";

type SourceRow = {
  id: string;
  url: string;
  title: string | null;
  last_crawled: string;
};

type ExistingChunkRow = {
  chunk_index: number;
  content_hash: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireNumberEnv(name: string): number {
  const value = Number(requireEnv(name));
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a valid number.`);
  }
  return value;
}

const RECrawl_DAYS = requireNumberEnv("RECRAWL_DAYS");
const RECRAWL_DELAY_MS = requireNumberEnv("RECRAWL_DELAY_MS");
const EMBED_BATCH_SIZE = requireNumberEnv("EMBED_BATCH_SIZE");

const SUPABASE_URL =
  (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
    /\/rest\/v1\/?$/,
    "",
  );
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const EMBEDDING_MODEL = requireEnv("EMBEDDING_MODEL");
const EMBEDDING_OUTPUT_DIM = requireNumberEnv("EMBEDDING_OUTPUT_DIM");

const FETCH_TIMEOUT_MS = Number(process.env.RECRAWL_FETCH_TIMEOUT_MS ?? 15000);
const SOURCE_PAGE_SIZE = Number(process.env.RECRAWL_SOURCE_PAGE_SIZE ?? 100);

if (!SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in environment.");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in environment.");
}

if (!Number.isInteger(SOURCE_PAGE_SIZE) || SOURCE_PAGE_SIZE <= 0) {
  throw new Error("RECRAWL_SOURCE_PAGE_SIZE must be a positive integer when provided.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function extractTextAndTitle(html: string): { title: string | null; text: string } {
  const $ = cheerio.load(html);

  $("script, style, noscript, svg, nav, footer").remove();

  const title = $("title").first().text().trim() || null;
  const main = $("main").text().trim();
  const body = $("body").text().trim();
  const text = (main || body).replace(/\s+/g, " ").trim();

  return { title, text };
}

type SourceCursor = {
  lastCrawled: string;
  id: string;
};

async function getDueSourcesPage(params: {
  threshold: string;
  cursor?: SourceCursor;
}): Promise<SourceRow[]> {
  const { threshold, cursor } = params;
  let query = supabase
    .from("sources")
    .select("id, url, title, last_crawled")
    // Intentionally no title filter: seed discovery inserts many rows with title=NULL.
    .lte("last_crawled", threshold)
    .order("last_crawled", { ascending: true })
    .order("id", { ascending: true })
    .limit(SOURCE_PAGE_SIZE);

  if (cursor) {
    query = query.or(
      `last_crawled.gt.${cursor.lastCrawled},and(last_crawled.eq.${cursor.lastCrawled},id.gt.${cursor.id})`,
    );
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? []) as SourceRow[];
}

async function getExistingChunkHashes(sourceId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("document_chunks")
    .select("chunk_index, content_hash")
    .eq("source_id", sourceId)
    .order("chunk_index", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as ExistingChunkRow[]).map((row) => row.content_hash);
}

async function markSourceCrawled(sourceId: string, title?: string | null): Promise<void> {
  const payload: { last_crawled: string; title?: string } = {
    last_crawled: new Date().toISOString(),
  };
  if (title) payload.title = title;

  const { error } = await supabase.from("sources").update(payload).eq("id", sourceId);
  if (error) throw error;
}

type ChunkRow = {
  source_id: string;
  content: string;
  chunk_index: number;
  content_hash: string;
  metadata: Record<string, unknown>;
  embedding: number[];
};

async function refreshChunksForSource(params: {
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string | null;
  chunks: string[];
}): Promise<void> {
  const { sourceId, sourceUrl, sourceTitle, chunks } = params;

  // 1) Embed everything FIRST. If any embedding call fails, we throw here
  //    before touching the database, so the source keeps its existing chunks.
  const rows: ChunkRow[] = [];
  for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
    const chunkBatch = chunks.slice(start, start + EMBED_BATCH_SIZE);

    const { embeddings } = await embedMany({
      model: google.textEmbeddingModel(EMBEDDING_MODEL),
      values: chunkBatch,
      providerOptions: {
        google: {
          outputDimensionality: EMBEDDING_OUTPUT_DIM,
          taskType: "RETRIEVAL_DOCUMENT",
        },
      },
    });

    chunkBatch.forEach((content, index) => {
      const chunkIndex = start + index;
      rows.push({
        source_id: sourceId,
        content,
        chunk_index: chunkIndex,
        content_hash: sha256(content),
        metadata: {
          source_url: sourceUrl,
          source_title: sourceTitle,
          chunk_index: chunkIndex,
          recrawled_at: new Date().toISOString(),
        },
        embedding: embeddings[index],
      });
    });
  }

  // 2) Only now swap the data: the unique (source_id, chunk_index) constraint
  //    forces delete-then-insert, but the slow/failure-prone embedding work is
  //    already done, so the window where chunks are missing is minimal.
  const { error: deleteError } = await supabase.from("document_chunks").delete().eq("source_id", sourceId);
  if (deleteError) throw deleteError;

  for (let start = 0; start < rows.length; start += EMBED_BATCH_SIZE) {
    const rowBatch = rows.slice(start, start + EMBED_BATCH_SIZE);
    const { error: insertError } = await supabase.from("document_chunks").insert(rowBatch);
    if (insertError) throw insertError;
  }
}

async function processSource(source: SourceRow): Promise<void> {
  const normalizedUrl = normalizeUrl(source.url);
  if (!normalizedUrl) {
    console.warn(`[SKIP] Invalid URL: ${source.url}`);
    return;
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(normalizedUrl, FETCH_TIMEOUT_MS);
  } catch (error) {
    console.warn(`[FAIL] ${source.id} ${normalizedUrl} -> fetch error/timeout`, error);
    return;
  }

  if (!response.ok) {
    console.warn(`[FAIL] ${source.id} ${normalizedUrl} -> HTTP ${response.status}`);
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    console.log(`[SKIP] ${source.id} non-HTML content: ${contentType}`);
    await markSourceCrawled(source.id, source.title);
    return;
  }

  const html = await response.text();
  const { title, text } = extractTextAndTitle(html);
  if (text.length < 200) {
    console.log(`[SKIP] ${source.id} low text content.`);
    await markSourceCrawled(source.id, title ?? source.title);
    return;
  }

  const chunks = await splitIntoChunks(text, {
    chunkSize: 1800,
    chunkOverlap: 250,
  });

  const existingHashes = await getExistingChunkHashes(source.id);
  const nextHashes = chunks.map((chunk) => sha256(chunk));
  const changed = !arraysEqual(existingHashes, nextHashes);

  if (!changed) {
    console.log(`[UNCHANGED] ${source.id} ${normalizedUrl}`);
    await markSourceCrawled(source.id, title ?? source.title);
    return;
  }

  console.log(`[UPDATED] ${source.id} ${normalizedUrl} -> ${chunks.length} chunks`);
  await refreshChunksForSource({
    sourceId: source.id,
    sourceUrl: normalizedUrl,
    sourceTitle: title ?? source.title,
    chunks,
  });
  await markSourceCrawled(source.id, title ?? source.title);
}

async function main(): Promise<void> {
  const threshold = new Date(Date.now() - RECrawl_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let cursor: SourceCursor | undefined;
  let totalProcessed = 0;

  console.log(
    `Starting recrawl pass (days=${RECrawl_DAYS}, delayMs=${RECRAWL_DELAY_MS}, pageSize=${SOURCE_PAGE_SIZE}, embeddingModel=${EMBEDDING_MODEL}, outputDim=${EMBEDDING_OUTPUT_DIM})`,
  );

  while (true) {
    const dueSources = await getDueSourcesPage({ threshold, cursor });
    if (dueSources.length === 0) {
      break;
    }

    console.log(`Processing due source page: ${dueSources.length}`);

    for (const source of dueSources) {
      try {
        await processSource(source);
      } catch (error) {
        console.error(`[ERROR] source_id=${source.id}`, error);
      }
      cursor = {
        lastCrawled: source.last_crawled,
        id: source.id,
      };
      totalProcessed += 1;
      await sleep(RECRAWL_DELAY_MS);
    }
  }

  console.log(`Recrawl pass complete. Processed ${totalProcessed} due sources.`);
}

main().catch((error) => {
  console.error("Fatal recrawl error:", error);
  process.exit(1);
});