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
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive integer, received: ${chunkSize}`);
  }
  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0) {
    throw new Error(`chunkOverlap must be a non-negative integer, received: ${chunkOverlap}`);
  }
  if (chunkOverlap >= chunkSize) {
    throw new Error(
      `chunkOverlap (${chunkOverlap}) must be smaller than chunkSize (${chunkSize}).`,
    );
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ["\n\n", "\n", ". ", "! ", "? ", " ", ""],
  });

  return splitter.splitText(normalized);
}
