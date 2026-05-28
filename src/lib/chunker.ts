import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export type ChunkerOptions = {
  chunkSize?: number;
  chunkOverlap?: number;
};

const DEFAULT_CHUNK_SIZE = 1800;
const DEFAULT_CHUNK_OVERLAP = 250;

export async function splitIntoChunks(
  text: string,
  options: ChunkerOptions = {},
): Promise<string[]> {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
    chunkOverlap: options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
    separators: ["\n\n", "\n", ". ", "! ", "? ", " ", ""],
  });

  return splitter.splitText(normalized);
}
