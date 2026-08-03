import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { LineReaderPort } from '../../application/ports/line-reader.port';

@Injectable()
export class ReadlineLineReader implements LineReaderPort {
  async *readLines(filePath: string): AsyncIterable<string> {
    const fileStream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        yield line;
      }
    } finally {
      rl.close();
      fileStream.destroy();
    }
  }
}
