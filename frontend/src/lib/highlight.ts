/** Utilitaires de mise en évidence d'un passage (chunk) dans un texte. */

/** Échappe les métacaractères regex d'un mot. */
function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Construit une regex tolérante aux espaces pour retrouver `chunk` dans un texte
 * dont les blancs ont pu être normalisés différemment (PDF, splitter…).
 * Retourne null si le passage est trop court pour être fiable.
 */
export function buildChunkRegex(chunk: string): RegExp | null {
  const words = chunk.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || chunk.trim().length < 3) return null;
  const pattern = words.map(escape).join("\\s+");
  try {
    return new RegExp(pattern, "gi");
  } catch {
    return null;
  }
}

export interface Segment {
  text: string;
  mark: boolean;
}

/**
 * Découpe `full` en segments en marquant chaque occurrence de `chunk`.
 * Si aucune occurrence n'est trouvée, retourne null (au caller de décider du repli).
 */
export function segmentText(full: string, chunk: string): Segment[] | null {
  const re = buildChunkRegex(chunk);
  if (!re) return null;

  const segments: Segment[] = [];
  let last = 0;
  let found = false;
  for (const m of full.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ text: full.slice(last, start), mark: false });
    segments.push({ text: m[0], mark: true });
    last = start + m[0].length;
    found = true;
  }
  if (!found) return null;
  if (last < full.length) segments.push({ text: full.slice(last), mark: false });
  return segments;
}

/**
 * Vrai si le segment de texte `str` (un item du calque texte PDF) fait partie du
 * passage `chunk`. Utilisé par le customTextRenderer de react-pdf.
 */
export function isWithinChunk(str: string, normalizedChunk: string): boolean {
  const s = str.trim();
  if (s.length < 2) return false;
  const norm = s.replace(/\s+/g, " ").toLowerCase();
  return normalizedChunk.includes(norm);
}

/** Normalise un passage pour comparaison (minuscules, blancs compactés). */
export function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
