/** Cryptographically random bytes, for bid nonces and pseudonyms. */
export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const toHex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('hex');

/**
 * Walk a ledger state and collect every bigint in it.
 *
 * The tests use this to prove a *negative*: that a losing bid's amount is not
 * anywhere in the public ledger. Checking `highestBid` alone would not catch an
 * amount smuggled into some other field, so we inspect the whole state.
 */
export const collectBigInts = (value: unknown, found: bigint[] = []): bigint[] => {
  if (typeof value === 'bigint') {
    found.push(value);
  } else if (value instanceof Map) {
    for (const [, v] of value) collectBigInts(v, found);
  } else if (Array.isArray(value) || value instanceof Uint8Array) {
    for (const v of value as unknown[]) collectBigInts(v, found);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectBigInts(v, found);
  }
  return found;
};

/**
 * Flatten a ledger state to a string so a test can assert that a piece of
 * private data (a nonce, say) never appears anywhere in the public state.
 */
export const serializeLedger = (value: unknown): string => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return toHex(value);
  if (Array.isArray(value)) return `[${value.map(serializeLedger).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      entries.push(`${k}:${serializeLedger(v)}`);
    }
    // Ledger maps expose themselves as iterables of [key, value].
    const maybeIterable = value as { [Symbol.iterator]?: () => Iterator<[unknown, unknown]> };
    if (typeof maybeIterable[Symbol.iterator] === 'function') {
      for (const [k, v] of value as unknown as Iterable<[unknown, unknown]>) {
        entries.push(`${serializeLedger(k)}=>${serializeLedger(v)}`);
      }
    }
    return `{${entries.join(',')}}`;
  }
  return String(value);
};
