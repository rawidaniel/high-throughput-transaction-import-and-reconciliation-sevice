export interface LineReaderPort {
  readLines(filePath: string): AsyncIterable<string>;
  countLines(filePath: string): Promise<number>;
}
