import { createClient } from "@supabase/supabase-js";
import {
  convertToModelMessages,
  embed,
  streamText,
  type UIMessage,
} from "ai";
import { google } from "@ai-sdk/google";

type MatchDocumentChunk = {
  id: string;
  source_id: string;
  content: string;
  source_url: string | null;
  source_title: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

type RetrievedSource = {
  sourceId: string;
  url: string;
  title: string;
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

function getSupabaseUrl(): string {
  return (process.env.SUPABASE_URL ?? requireEnv("NEXT_PUBLIC_SUPABASE_URL")).replace(
    /\/rest\/v1\/?$/,
    "",
  );
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/\s+/g, "-");
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function getLatestUserQuery(messages: UIMessage[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUserMessage) {
    throw new Error("Request must include at least one user message.");
  }

  const query = getMessageText(latestUserMessage);
  if (!query) {
    throw new Error("Latest user message is empty.");
  }

  return query;
}

function formatContext(chunks: MatchDocumentChunk[]): string {
  if (chunks.length === 0) {
    return "No matching context chunks were found in the vector database.";
  }

  return chunks
    .map(
      (chunk, index) => `
[מקור ${index + 1}]
chunk_id: ${chunk.id}
source_id: ${chunk.source_id}
similarity: ${chunk.similarity}
source_url: ${chunk.source_url ?? ""}
source_title: ${chunk.source_title ?? ""}
metadata: ${JSON.stringify(chunk.metadata ?? {})}

content:
${chunk.content}
`,
    )
    .join("\n\n");
}

export async function POST(request: Request) {
  try {
    const { messages } = (await request.json()) as { messages?: UIMessage[] };
    if (!Array.isArray(messages)) {
      return Response.json({ error: "Request body must include a messages array." }, { status: 400 });
    }

    const latestUserQuery = getLatestUserQuery(messages);

    const languageModel = normalizeModelId(requireEnv("NEXT_PUBLIC_AGENT_MODEL"));
    const embeddingModel = process.env.EMBEDDING_MODEL ?? requireEnv("NEXT_PUBLIC_EMBEDDING_MODEL");
    const embeddingOutputDim = requireNumberEnv("EMBEDDING_OUTPUT_DIM");
    const rpcFunctionName = requireEnv("RAG_MATCH_RPC_FUNCTION");
    const matchThreshold = requireNumberEnv("RAG_MATCH_THRESHOLD");
    const matchCount = requireNumberEnv("RAG_MATCH_COUNT");

    const supabase = createClient(getSupabaseUrl(), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { embedding } = await embed({
      model: google.textEmbeddingModel(embeddingModel),
      value: latestUserQuery,
      providerOptions: {
        google: {
          outputDimensionality: embeddingOutputDim,
          taskType: "RETRIEVAL_QUERY",
        },
      },
    });

    const { data, error } = await supabase.rpc(rpcFunctionName, {
      query_embedding: embedding,
      match_threshold: matchThreshold,
      match_count: matchCount,
    });

    if (error) {
      throw error;
    }

    const chunks = (data ?? []) as MatchDocumentChunk[];
    const context = formatContext(chunks);
    const modelMessages = await convertToModelMessages(messages);
    const uniqueSources = new Map<string, RetrievedSource>();
    for (const chunk of chunks) {
      const url = chunk.source_url;
      if (!url || uniqueSources.has(url)) continue;
      uniqueSources.set(url, {
        sourceId: chunk.id,
        url,
        title: chunk.source_title ?? url,
      });
    }
    const sources = Array.from(uniqueSources.values());

    const result = streamText({
      model: google(languageModel),
      system: `
אתה עוזר אקדמי לסטודנטים ב-HIT.
ענה בעברית טבעית, ברורה וקצרה.
עליך לענות אך ורק לפי ההקשר ממסד הנתונים הווקטורי שמופיע למטה.
אסור להשתמש בידע חיצוני, בהשערות, או במידע שלא מופיע בהקשר.
אם ההקשר אינו מספיק כדי לענות בביטחון, אמור בעברית שאין מספיק מידע במקורות שנמצאו.

הקשר ממסד הנתונים:
${context}
`,
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: () => {
        return { sources };
      },
    });
  } catch (error) {
    console.error("Chat route error:", error);
    const message = error instanceof Error ? error.message : "Unknown chat route error.";
    return Response.json({ error: message }, { status: 500 });
  }
}
