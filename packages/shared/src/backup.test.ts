import { describe, expect, it } from 'vitest';
import { ageRecipientProblem, ageRecipientSchema, backupConfigPatchSchema } from './backup.js';

/** The example recipient from age's own README. */
const X25519 = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** Just enough bech32 to make a correctly checksummed plugin-style recipient for the tests. */
function bech32(prefix: string, data: number[]): string {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  const polymod = (values: number[]) => {
    let checksum = 1;
    for (const value of values) {
      const top = checksum >>> 25;
      checksum = ((checksum & 0x1ffffff) << 5) ^ value;
      for (let bit = 0; bit < 5; bit++) if ((top >>> bit) & 1) checksum ^= generator[bit]!;
    }
    return checksum;
  };
  const expanded = [...[...prefix].map((c) => c.charCodeAt(0) >> 5), 0, ...[...prefix].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${prefix}1${[...data, ...checksum].map((v) => CHARSET[v]).join('')}`;
}

describe('ageRecipientProblem', () => {
  it('accepts real keys, in either case', () => {
    expect(ageRecipientProblem(X25519)).toBeNull();
    expect(ageRecipientProblem(X25519.toUpperCase())).toBeNull();
    expect(ageRecipientProblem(`  ${X25519}\n`)).toBeNull();
    expect(ageRecipientProblem(bech32('age1yubikey', Array.from({ length: 53 }, (_, i) => i % 32)))).toBeNull();
  });

  it('rejects made-up, truncated and mistyped keys', () => {
    expect(ageRecipientProblem('test')).toBe('notAgeKey');
    expect(ageRecipientProblem('age1')).toBe('invalid');
    expect(ageRecipientProblem('age1qqqqqqqqqqqqqqqqqqqq')).toBe('invalid');
    expect(ageRecipientProblem(X25519.slice(0, -1))).toBe('invalid');
    // One character changed breaks the checksum.
    expect(ageRecipientProblem(X25519.replace('ql3z', 'ql3x'))).toBe('invalid');
    expect(ageRecipientProblem(X25519.slice(0, 10) + X25519.slice(10).toUpperCase())).toBe('invalid');
  });

  it('recognizes a pasted secret key', () => {
    expect(ageRecipientProblem('AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ')).toBe('secretKey');
    expect(ageRecipientProblem('AGE-PLUGIN-YUBIKEY-1QQQQQQ')).toBe('secretKey');
  });
});

describe('backup schemas', () => {
  it('stores recipients in lower case and explains a bad one', () => {
    expect(ageRecipientSchema.parse(X25519.toUpperCase())).toBe(X25519);
    const result = ageRecipientSchema.safeParse('test');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/start with age1/);
  });

  it('leaves unsent sections out of a patch instead of defaulting them', () => {
    expect(backupConfigPatchSchema.parse({ enabled: true })).toEqual({ enabled: true });
  });
});
