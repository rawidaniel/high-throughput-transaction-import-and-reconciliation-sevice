import {
  parseNdjsonLine,
  MAX_LINE_BYTES,
} from '../../../src/domain/transaction/parse-ndjson-line';

describe('parseNdjsonLine (unit, pure)', () => {
  it('parses a valid JSON line', () => {
    const result = parseNdjsonLine('{"transactionId":"t1","amount":10}', 1);
    expect(result).toEqual({
      kind: 'valid',
      lineNumber: 1,
      data: { transactionId: 't1', amount: 10 },
    });
  });

  it('treats an empty line as blank, not rejected', () => {
    expect(parseNdjsonLine('', 5)).toEqual({ kind: 'blank' });
  });

  it('treats a whitespace-only line as blank', () => {
    expect(parseNdjsonLine('   \t  ', 6)).toEqual({ kind: 'blank' });
  });

  it('handles the final line with no trailing newline the same as any other line', () => {
    const result = parseNdjsonLine('{"transactionId":"last"}', 42);
    expect(result.kind).toBe('valid');
  });

  it('rejects malformed JSON without throwing', () => {
    const result = parseNdjsonLine('{not valid json', 3);
    expect(result).toMatchObject({
      kind: 'rejected',
      errorCode: 'INVALID_JSON',
      lineNumber: 3,
    });
  });

  it('rejects a line exceeding the byte limit as LINE_TOO_LONG', () => {
    const hugeLine = '{"padding":"' + 'x'.repeat(MAX_LINE_BYTES + 100) + '"}';
    const result = parseNdjsonLine(hugeLine, 7);
    expect(result).toMatchObject({
      kind: 'rejected',
      errorCode: 'LINE_TOO_LONG',
      lineNumber: 7,
    });
  });

  it('truncates the raw value stored on a rejection, never the full line', () => {
    const hugeLine = 'x'.repeat(MAX_LINE_BYTES + 500);
    const result = parseNdjsonLine(hugeLine, 8);
    if (result.kind !== 'rejected') throw new Error('expected rejected');
    expect(result.rawValueTruncated.length).toBeLessThanOrEqual(200);
  });
});
