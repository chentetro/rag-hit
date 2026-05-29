import { createClient } from "@supabase/supabase-js";
import { embed, generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const SUPABASE_URL =
  (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
    /\/rest\/v1\/?$/,
    "",
  );

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "gemini-embedding-001";
const EMBEDDING_OUTPUT_DIM = Number(process.env.EMBEDDING_OUTPUT_DIM ?? 768);
const ANSWER_MODEL = process.env.AGENT_MODEL ?? "gemini-2.5-flash";

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL.");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EvaluationSchema = z.object({
  answeredFromContext: z.boolean(),
  answer: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  usedChunkIds: z.array(z.string()),
  reasoning: z.string(),
  missingInformation: z.array(z.string()),
});

async function main() {
  const query = process.argv.slice(2).join(" ").trim();

  if (!query) {
    throw new Error(`Usage: npx tsx --env-file=.env src/scripts/evaluate-rag-query.ts "your question"`);
  }

  const { embedding } = await embed({
    model: google.textEmbeddingModel(EMBEDDING_MODEL),
    value: query,
    providerOptions: {
      google: {
        outputDimensionality: EMBEDDING_OUTPUT_DIM,
        taskType: "RETRIEVAL_QUERY",
      },
    },
  });

  const { data: candidates, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: embedding,
    match_threshold: 0.3,
    match_count: 8,
  });

  if (error) throw error;

  const context = (candidates ?? [])
    .map(
      (chunk: any, index: number) => `
[CHUNK ${index + 1}]
id: ${chunk.id}
similarity: ${chunk.similarity}
source_url: ${chunk.source_url}
source_title: ${chunk.source_title ?? ""}
metadata: ${JSON.stringify(chunk.metadata ?? {})}

content:
${chunk.content}
`,
    )
    .join("\n\n");

  const { object } = await generateObject({
    model: google(ANSWER_MODEL),
    schema: EvaluationSchema,
    prompt: `
You are evaluating whether a user question can be answered using ONLY the provided vector database context.

Rules:
- Use only the context below.
- Do not use outside knowledge.
- If the context is insufficient, set answeredFromContext=false.
- If answeredFromContext=true, cite the exact chunk IDs used in usedChunkIds.
- The answer must be grounded only in the chunks.

User query:
${query}

Vector database context:
${context}
`,
  });

  console.log(
    JSON.stringify(
      {
        query,
        evaluation: object,
        candidates: (candidates ?? []).map((chunk: any) => ({
          id: chunk.id,
          source_id: chunk.source_id,
          similarity: chunk.similarity,
          source_url: chunk.source_url,
          source_title: chunk.source_title,
          metadata: chunk.metadata,
          preview: chunk.content.slice(0, 300),
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});