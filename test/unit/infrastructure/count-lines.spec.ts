import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReadlineLineReader } from '../../../src/infrastructure/streaming/readline-line-reader';

describe('ReadlineLineReader.countLines', () => {
  let dir: string;
  let reader: ReadlineLineReader;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'countlines-'));
    reader = new ReadlineLineReader();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function countOf(content: string): Promise<number> {
    const file = path.join(
      dir,
      `f-${Math.random().toString(36).slice(2)}.ndjson`,
    );
    await writeFile(file, content);
    return reader.countLines(file);
  }

  it.each([
    ['normal file with trailing newline', '{"a":1}\n{"a":2}\n{"a":3}\n', 3],
    ['final line without trailing newline', '{"a":1}\n{"a":2}\n{"a":3}', 3],
    ['blank lines interspersed', '{"a":1}\n\n\n{"a":2}\n', 2],
    ['whitespace-only lines', '{"a":1}\n   \n\t\n{"a":2}\n', 2],
    ['CRLF line endings', '{"a":1}\r\n{"a":2}\r\n', 2],
    ['empty file', '', 0],
    ['only blank lines', '\n\n   \n\t\n', 0],
    ['single line, no newline', '{"a":1}', 1],
    ['multi-byte UTF-8 content', '{"d":"café ☕ 日本"}\n{"a":2}\n', 2],
  ])('counts %s correctly', async (_name, content, expected) => {
    await expect(countOf(content as string)).resolves.toBe(expected);
  });

  it('agrees with the blank-skipping rule used during processing', async () => {
    const content = '{"a":1}\n\n  \n{"a":2}\n\t\n{"a":3}';
    const reference = content
      .split('\n')
      .filter((l) => l.trim().length > 0).length;
    await expect(countOf(content)).resolves.toBe(reference);
  });
});
