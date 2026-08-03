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

  async countLines(filePath: string): Promise<number> {
    const stream = createReadStream(filePath);
    let count = 0;
    let currentLineHasContent = false;

    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        for (let i = 0; i < chunk.length; i++) {
          const byte = chunk[i];
          if (byte === 0x0a) {
            if (currentLineHasContent) count++;
            currentLineHasContent = false;
          } else if (byte !== 0x0d && byte !== 0x20 && byte !== 0x09) {
            currentLineHasContent = true;
          }
        }
      }
      if (currentLineHasContent) count++;
    } finally {
      stream.destroy();
    }

    return count;
  }
}
