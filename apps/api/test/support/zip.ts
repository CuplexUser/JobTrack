/**
 * A minimal ZIP central-directory reader.
 *
 * Exists because of a real bug: exceljs's *streaming* writer produced archives whose
 * central directory recorded `crc = 0` and `uncompressed size = 0` for several entries.
 * The compressed bytes were intact, so lenient readers (including exceljs's own) opened
 * the file happily — but readers that trust the central directory, which is the spec-
 * correct thing to do, saw those entries as empty and rejected the workbook.
 *
 * Asserting through a tolerant reader is what let that ship. This reads the same metadata
 * a strict consumer would.
 */

export interface ZipEntry {
  name: string;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Directory markers legitimately carry no data. */
  isDirectory: boolean;
}

const END_OF_CENTRAL_DIR = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;

/** Parse the central directory of a ZIP archive. */
export function readZipCentralDirectory(buffer: Buffer): ZipEntry[] {
  // The end-of-central-directory record sits at the tail, after a comment of unknown
  // length, so it has to be found by scanning backwards for its signature.
  let end = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIR) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error('Not a ZIP archive: no end-of-central-directory record');

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new Error(`Corrupt central directory at entry ${i}`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    entries.push({
      name,
      crc: buffer.readUInt32LE(offset + 16),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      isDirectory: name.endsWith('/'),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Entries that claim to hold data but record none — the signature of the bug above. */
export function entriesMissingMetadata(buffer: Buffer): string[] {
  return readZipCentralDirectory(buffer)
    .filter((entry) => !entry.isDirectory && entry.crc === 0 && entry.uncompressedSize === 0)
    .map((entry) => entry.name);
}
