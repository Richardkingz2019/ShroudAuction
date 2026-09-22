/**
 * The bidder's private state and the witness functions the Compact contract
 * reads, mirroring src/witnesses.ts in the repository root.
 *
 * None of this is ever sent anywhere. It is handed to the wallet's proving
 * provider inside the circuit execution and appears in the transaction only as
 * whatever the contract explicitly disclose()s — for a sealed bid that is the
 * pseudonym and a 32-byte hash, never the amount.
 */

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

export interface ShroudAuctionPrivateState {
  /** The real bid, in the smallest unit of the auction's currency. Never shown. */
  readonly bidAmount: bigint;
  /** 32 random bytes that blind the commitment so the amount cannot be brute-forced. */
  readonly bidNonce: Uint8Array;
  /** A pseudonym the bidder picks — the only identifier that reaches the chain. */
  readonly bidderAlias: Uint8Array;
}

export const createShroudAuctionPrivateState = (
  bidAmount: bigint,
  bidNonce: Uint8Array,
  bidderAlias: Uint8Array,
): ShroudAuctionPrivateState => ({ bidAmount, bidNonce, bidderAlias });

/** A placeholder private state for someone who is only observing the auction. */
export const createEmptyPrivateState = (): ShroudAuctionPrivateState =>
  createShroudAuctionPrivateState(0n, new Uint8Array(32), new Uint8Array(32));

/**
 * One function per witness declared in contracts/auction.compact. Each returns
 * `[privateState, value]`; these are pure readers, so the state passes through
 * unchanged.
 */
export const witnesses = {
  bidAmount: ({
    privateState,
  }: WitnessContext<unknown, ShroudAuctionPrivateState>): [ShroudAuctionPrivateState, bigint] => [
    privateState,
    privateState.bidAmount,
  ],
  bidNonce: ({
    privateState,
  }: WitnessContext<unknown, ShroudAuctionPrivateState>): [
    ShroudAuctionPrivateState,
    Uint8Array,
  ] => [privateState, privateState.bidNonce],
  bidderAlias: ({
    privateState,
  }: WitnessContext<unknown, ShroudAuctionPrivateState>): [
    ShroudAuctionPrivateState,
    Uint8Array,
  ] => [privateState, privateState.bidderAlias],
};

/** Cryptographically random 32 bytes for nonces and pseudonyms. */
export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
};
