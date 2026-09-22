/**
 * Split a document into chunks the retriever can embed.
 *
 * Structure-aware, not fixed-width: headings start new sections and travel
 * with every chunk cut from their section, so a passage about "Refund policy"
 * still says so after it is pulled out of context. Paragraphs are packed up to
 * a token target; long paragraphs are split on sentences; consecutive chunks
 * overlap by a few sentences so an answer that straddles a boundary survives.
 */
export interface Chunk {
  ordinal: number;
  heading: string | null;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  /** Target size per chunk. Default 350 tokens ≈ 1 400 characters. */
  targetTokens?: number;
  /** Sentences repeated from the previous chunk. Default 2. */
  overlapSentences?: number;
}

/** ~4 characters per token for English/Vietnamese prose — good enough for sizing. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function chunkDocument(text: string, options: ChunkOptions = {}): Chunk[] {
  const target = options.targetTokens ?? 350;
  const overlap = options.overlapSentences ?? 2;
  const chunks: Chunk[] = [];

  for (const section of splitSections(text)) {
    const sentences = section.body.flatMap(splitSentences);
    let buffer: string[] = [];
    const flush = () => {
      const content = buffer.join(" ").trim();
      if (!content) return;
      const withHeading = section.heading ? `${section.heading}\n${content}` : content;
      chunks.push({ ordinal: chunks.length, heading: section.heading, content: withHeading, tokenCount: estimateTokens(withHeading) });
    };
    for (const sentence of sentences) {
      if (buffer.length > 0 && estimateTokens(buffer.join(" ")) + estimateTokens(sentence) > target) {
        flush();
        buffer = buffer.slice(-overlap);
      }
      buffer.push(sentence);
    }
    flush();
  }
  return chunks;
}

interface Section {
  heading: string | null;
  body: string[];
}

function splitSections(text: string): Section[] {
  // Line-based: a heading line starts a section; blank lines end a paragraph.
  // (Splitting on blank lines first would glue "## Heading\nFirst paragraph" together.)
  const sections: Section[] = [];
  let current: Section = { heading: null, body: [] };
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) current.body.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) {
      endParagraph();
      if (current.body.length || current.heading) sections.push(current);
      current = { heading: heading[1]!.trim(), body: [] };
    } else if (!line) {
      endParagraph();
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();
  if (current.body.length || current.heading) sections.push(current);
  return sections;
}

function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?…])\s+(?=[A-ZÀ-Ỹ0-9"'(])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}
