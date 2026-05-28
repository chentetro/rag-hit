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

const RECrawl_DAYS = Number(process.env.RECRAWL_DAYS ?? 7);
const RECRAWL_BATCH_SIZE = Number(process.env.RECRAWL_BATCH_SIZE ?? 2);
const EMBED_BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE ?? 4);

const SUPABASE_URL =
  (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
    /\/rest\/v1\/?$/,
    "",
  );
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const RAW_EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? process.env.NEXT_PUBLIC_EMBEDDING_MODEL ?? "gemini-embedding-001";

const LEGACY_EMBEDDING_MODEL_ALIASES: Record<string, string> = {
  "embedding-001": "gemini-embedding-001",
  "text-embedding-004": "gemini-embedding-001",
};

const EMBEDDING_MODEL = LEGACY_EMBEDDING_MODEL_ALIASES[RAW_EMBEDDING_MODEL] ?? RAW_EMBEDDING_MODEL;

const EMBEDDING_OUTPUT_DIM = Number(process.env.EMBEDDING_OUTPUT_DIM ?? 768);

if (!SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in environment.");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in environment.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
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

async function getDueSources(limit: number): Promise<SourceRow[]> {
  const threshold = new Date(Date.now() - RECrawl_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("sources")
    .select("id, url, title, last_crawled")
    .lte("last_crawled", threshold)
    .order("last_crawled", { ascending: true })
    .limit(limit);

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

async function refreshChunksForSource(params: {
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string | null;
  chunks: string[];
}): Promise<void> {
  const { sourceId, sourceUrl, sourceTitle, chunks } = params;

  const { error: deleteError } = await supabase.from("document_chunks").delete().eq("source_id", sourceId);
  if (deleteError) throw deleteError;

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

    const rows = chunkBatch.map((content, index) => {
      const chunkIndex = start + index;
      return {
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
      };
    });

    const { error: insertError } = await supabase.from("document_chunks").insert(rows);
    if (insertError) throw insertError;
  }
}

async function processSource(source: SourceRow): Promise<void> {
  const normalizedUrl = normalizeUrl(source.url);
  if (!normalizedUrl) {
    console.warn(`[SKIP] Invalid URL: ${source.url}`);
    return;
  }

  const response = await fetch(normalizedUrl, { redirect: "follow" });
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
  if (RAW_EMBEDDING_MODEL !== EMBEDDING_MODEL) {
    console.warn(
      `Embedding model '${RAW_EMBEDDING_MODEL}' is not supported by @ai-sdk/google. Auto-mapped to '${EMBEDDING_MODEL}'.`,
    );
  }

  console.log(
    `Starting recrawl pass (days=${RECrawl_DAYS}, batchSize=${RECRAWL_BATCH_SIZE}, embeddingModel=${EMBEDDING_MODEL}, outputDim=${EMBEDDING_OUTPUT_DIM})`,
  );

  const dueSources = await getDueSources(RECRAWL_BATCH_SIZE);
  console.log(`Due sources found: ${dueSources.length}`);

  for (const source of dueSources) {
    try {
      await processSource(source);
    } catch (error) {
      console.error(`[ERROR] source_id=${source.id}`, error);
    }
  }

  console.log("Recrawl pass complete.");
}

main().catch((error) => {
  console.error("Fatal recrawl error:", error);
  process.exit(1);
});