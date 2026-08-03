export interface LineReaderPort {
  readLines(filePath: string): AsyncIterable<string>;
}
