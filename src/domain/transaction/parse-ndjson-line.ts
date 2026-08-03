export const MAX_LINE_BYTES = 64 * 1024;

export type LineParseResult =
  | { kind: 'blank' }
  | { kind: 'valid'; lineNumber: number; data: unknown }
  | {
      kind: 'rejected';
      lineNumber: number;
      errorCode: 'LINE_TOO_LONG' | 'INVALID_JSON';
      message: string;
      rawValueTruncated: string;
    };

export function parseNdjsonLine(
  rawLine: string,
  lineNumber: number,
): LineParseResult {
  const trimmed = rawLine.trim();

  if (trimmed.length === 0) {
    return { kind: 'blank' };
  }

  if (Buffer.byteLength(trimmed, 'utf8') > MAX_LINE_BYTES) {
    return {
      kind: 'rejected',
      lineNumber,
      errorCode: 'LINE_TOO_LONG',
      message: `Line exceeds the ${MAX_LINE_BYTES}-byte limit.`,
      rawValueTruncated: trimmed.slice(0, 200),
    };
  }

  try {
    const data = JSON.parse(trimmed) as unknown;
    return { kind: 'valid', lineNumber, data };
  } catch (err) {
    return {
      kind: 'rejected',
      lineNumber,
      errorCode: 'INVALID_JSON',
      message: err instanceof Error ? err.message : 'Malformed JSON.',
      rawValueTruncated: trimmed.slice(0, 200),
    };
  }
}
