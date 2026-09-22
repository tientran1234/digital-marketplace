export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Voyage AI — Anthropic's recommended embeddings partner. voyage-3 is 1024-d,
 * which is what the ProductChunk.embedding column is declared as.
 */
export class VoyageEmbedder implements Embedder {
  readonly model = "voyage-3";
  readonly dimensions = EMBEDDING_DIMENSIONS;
  constructor(private readonly apiKey: string) {}

  async embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts, input_type: kind }),
    });
    if (!res.ok) throw new Error(`voyage: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/**
 * Deterministic bag-of-words embedder for tests and offline dev: each word
 * hashes to a dimension, vectors are L2-normalised. Texts sharing words score
 * higher — enough to exercise retrieval and MMR without a network call.
 */
export class HashEmbedder implements Embedder {
  readonly model = "hash-bow";
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(texts: string[], _kind?: "document" | "query"): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const word of t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        let h = 2166136261;
        for (const ch of word) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
        v[h % this.dimensions]! += 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
}
