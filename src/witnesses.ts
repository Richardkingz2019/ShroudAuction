/*
 * The private state of a ShroudAuction bidder, plus the witness functions that
 * expose it to the Compact contract.
 *
 * None of this ever leaves the bidder's machine. The values are handed to the
 * proof server inside the circuit execution and appear nowhere in the
 * transaction that goes on-chain — the generated circuits only ever publish
 * what the contract explicitly disclose()s.
 */

import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../contracts/managed/auction/contract/index.js';

export type ShroudAuctionPrivateState = {
  /** The real bid, in the smallest unit of the auction's chosen currency. */
  readonly bidAmount: bigint;
  /** 32 random bytes that blind the commitment (see contracts/auction.compact). */
  readonly bidNonce: Uint8Array;
  /**
   * A pseudonym the bidder picks. It is what shows up in the public
   * `sealedBids` map and identifies the winner, without being linkable to the
   * bidder's wallet key.
   */
  readonly bidderAlias: Uint8Array;
};

export const createShroudAuctionPrivateState = (
  bidAmount: bigint,
  bidNonce: Uint8Array,
  bidderAlias: Uint8Array,
): ShroudAuctionPrivateState => ({
  bidAmount,
  bidNonce,
  bidderAlias,
});

/**
 * One field per witness declared in contracts/auction.compact. Each function
 * receives a WitnessContext and returns a tuple of [new private state, value].
 * The witnesses here are pure readers, so they hand the private state back
 * unchanged.
 */
export const witnesses = {
  bidAmount: ({
    privateState,
  }: WitnessContext<Ledger, ShroudAuctionPrivateState>): [
    ShroudAuctionPrivateState,
    bigint,
  ] => [privateState, privateState.bidAmount],

  bidNonce: ({
    privateState,
  }: WitnessContext<Ledger, ShroudAuctionPrivateState>): [
    ShroudAuctionPrivateState,
    Uint8Array,
  ] => [privateState, privateState.bidNonce],

  bidderAlias: ({
    privateState,
  }: WitnessContext<Ledger, ShroudAuctionPrivateState>): [
    ShroudAuctionPrivateState,
    Uint8Array,
  ] => [privateState, privateState.bidderAlias],
};
