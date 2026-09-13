/**
 * A minimal zip writer: deflate, UTF-8 names, no zip64, fixed timestamps.
 *
 * An extension package is a plain zip of a few dozen kilobytes, and Node has deflate and CRC-32
 * built in, so a dependency for it would be all cost. Fixed timestamps make packaging the same
 * commit twice produce the same bytes, so a rebuilt package can be compared with a released one.
 *
 * Format: PKWARE APPNOTE.TXT, sections 4.3.7 (local header), 4.3.12 (central directory) and
 * 4.3.16 (end of central directory).
 */

import { crc32, deflateRawSync } from 'node:zlib';

/** 1980-01-01 00:00, the earliest time a zip can hold, in DOS time and date format. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** General-purpose flag bit 11: file names are UTF-8. */
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const STORE = 0;
const VERSION = 20;

/**
 * @param {{ name: string; data: Buffer | Uint8Array }[]} entries  Paths use forward slashes.
 * @returns {Buffer}
 */
export function createZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of sorted) {
    if (entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..')) {
      throw new Error(`Refusing to write an unsafe zip entry name: ${entry.name}`);
    }
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data);
    const deflated = deflateRawSync(data, { level: 9 });
    // Deflate can make tiny or already-compressed files (the PNG icons) larger; store those.
    const method = deflated.length < data.length ? DEFLATE : STORE;
    const body = method === DEFLATE ? deflated : data;
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // Extra field length, comment length, disk number, internal and external attributes: all 0.
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}
