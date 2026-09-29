/**
 * ShroudAuction contract & circuit tests matching Level 3 Challenge specification.
 *
 * Covers:
 *   a) Circuit logic    — does the circuit compute correctly?
 *   b) State transitions — does ledger state update as expected?
 *   c) Privacy          — private input is never exposed in any output
 */

import { describe, expect, it } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import { Phase } from '../contracts/managed/auction/contract/index.js';
import { createShroudAuctionPrivateState } from '../src/witnesses.js';
import { ShroudAuctionSimulator } from './auction-simulator.js';
import { collectBigInts, randomBytes, serializeLedger, toHex } from './utils.js';

setNetworkId('undeployed');

/** Creates a test bidder with private amount, nonce, and pseudonym alias. */
const createBidder = (amount: bigint, alias?: Uint8Array) =>
  createShroudAuctionPrivateState(amount, randomBytes(32), alias ?? randomBytes(32));

describe('Contract Verification Suite (counter.test.ts)', () => {
  // a) Circuit logic — does the circuit compute correctly?
  describe('Circuit logic', () => {
    it('computes commitment correctly and verifies in-circuit match with witness values', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = createBidder(500n);
      const commitment = sim.bidCommitment(500n, alice.bidderAlias, alice.bidNonce);

      expect(commitment).toBeInstanceOf(Uint8Array);
      expect(commitment.length).toBe(32);

      // Submit valid sealed bid verified by circuit
      sim.submitSealedBid(alice, commitment);

      const state = sim.getLedger();
      expect(state.bidCount).toBe(1n);
      expect(state.sealedBids.lookup(alice.bidderAlias)).toEqual(commitment);
    });

    it('rejects bid submission when witness input does not match published commitment', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = createBidder(100n);
      const forgedCommitment = sim.bidCommitment(999n, alice.bidderAlias, alice.bidNonce);

      expect(() => sim.submitSealedBid(alice, forgedCommitment)).toThrow(
        'failed assert: Commitment does not match the sealed bid',
      );
    });
  });

  // b) State transitions — does ledger state update as expected?
  describe('State transitions', () => {
    it('transitions correctly through lifecycle: Bidding -> Revealing -> Settled', () => {
      const sim = new ShroudAuctionSimulator();
      const bidder1 = createBidder(250n);
      const commitment = sim.bidCommitment(250n, bidder1.bidderAlias, bidder1.bidNonce);

      // Phase 0: Bidding
      expect(sim.getLedger().phase).toBe(Phase.Bidding);
      sim.submitSealedBid(bidder1, commitment);
      expect(sim.getLedger().bidCount).toBe(1n);

      // Transition to Phase 1: Revealing
      const revealingState = sim.closeBidding();
      expect(revealingState.phase).toBe(Phase.Revealing);

      // Reveal bid inside revealing phase
      const afterReveal = sim.revealBid(bidder1);
      expect(afterReveal.phase).toBe(Phase.Revealing);
      expect(afterReveal.revealedCount).toBe(1n);
      expect(afterReveal.highestBid).toBe(250n);
      expect(afterReveal.highestBidder).toEqual(bidder1.bidderAlias);

      // Transition to Phase 2: Settled
      const settledState = sim.settle();
      expect(settledState.phase).toBe(Phase.Settled);
      expect(settledState.highestBid).toBe(250n);
    });

    it('enforces transition guards preventing premature reveals or double-closing', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = createBidder(100n);
      const commitment = sim.bidCommitment(100n, alice.bidderAlias, alice.bidNonce);
      sim.submitSealedBid(alice, commitment);

      // Cannot reveal while in Bidding phase
      expect(() => sim.revealBid(alice)).toThrow(
        'failed assert: Bids can only be revealed in the reveal phase',
      );

      // Close bidding once
      sim.closeBidding();

      // Cannot close bidding again
      expect(() => sim.closeBidding()).toThrow(
        'failed assert: Bidding is already closed',
      );
    });
  });

  // c) Privacy — private input is never exposed in any output
  describe('Privacy', () => {
    it('ensures private witness input (amount and nonce) is never leaked to public ledger state', () => {
      const sim = new ShroudAuctionSimulator();
      const secretAmount = 777n;
      const secretBidder = createBidder(secretAmount);
      const commitment = sim.bidCommitment(
        secretAmount,
        secretBidder.bidderAlias,
        secretBidder.bidNonce,
      );

      sim.submitSealedBid(secretBidder, commitment);
      const ledger = sim.getLedger();

      // Verify the public state contains the 32-byte commitment hash
      const serialized = serializeLedger(ledger);
      expect(serialized).toContain(toHex(commitment));

      // Verify the secret amount and nonce NEVER appear in public ledger
      expect(collectBigInts(ledger)).not.toContain(secretAmount);
      expect(serialized).not.toContain(toHex(secretBidder.bidNonce));
      expect(ledger.highestBid).toBe(0n);
    });

    it('never leaks losing bid amounts on-chain even after being revealed', () => {
      const sim = new ShroudAuctionSimulator();
      const winner = createBidder(1000n);
      const loser = createBidder(350n);

      sim.submitSealedBid(winner, sim.bidCommitment(1000n, winner.bidderAlias, winner.bidNonce));
      sim.submitSealedBid(loser, sim.bidCommitment(350n, loser.bidderAlias, loser.bidNonce));
      sim.closeBidding();

      // Winner reveals first
      sim.revealBid(winner);
      expect(sim.getLedger().highestBid).toBe(1000n);

      // Loser reveals second
      sim.revealBid(loser);
      const ledgerAfterLoser = sim.getLedger();

      // Loser reveal count incremented, but highest bid remains winner's amount
      expect(ledgerAfterLoser.revealedCount).toBe(2n);
      expect(ledgerAfterLoser.highestBid).toBe(1000n);
      expect(ledgerAfterLoser.highestBidder).toEqual(winner.bidderAlias);

      // Loser amount (350n) and loser nonce are nowhere in the public ledger
      const allBigInts = collectBigInts(ledgerAfterLoser);
      expect(allBigInts).not.toContain(350n);
      expect(serializeLedger(ledgerAfterLoser)).not.toContain(toHex(loser.bidNonce));
    });
  });
});
