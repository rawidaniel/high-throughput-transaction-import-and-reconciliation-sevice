import { LineReaderPort } from 'src/application/ports/line-reader.port';

export class FakeLineReader implements LineReaderPort {
  public wasClosedEarly = false;
  constructor(private readonly lines: string[]) {}

  async *readLines(): AsyncIterable<string> {
    let yieldedCount = 0;
    try {
      for (const line of this.lines) {
        yield line;
        yieldedCount++;
      }
    } finally {
      this.wasClosedEarly = yieldedCount < this.lines.length;
    }
  }

  async countLines(): Promise<number> {
    return this.lines.filter((l) => l.trim().length > 0).length;
  }
}
