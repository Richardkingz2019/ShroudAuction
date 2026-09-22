/**
 * ShroudAuction contract tests.
 *
 * These run against the compiled contract in contracts/managed/auction, so run
 * `npm run compile` first (`npm test` assumes it has already happened).
 *
 * The suite covers three things:
 *   1. circuit logic      — the commitment check and the duplicate-bid guard
 *   2. state transitions  — Bidding -> Revealing -> Settled, and what blocks each
 *   3. privacy            — that witness values never reach the public ledger
 */

import { describe, expect, it } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import { Phase } from '../contracts/managed/auction/contract/index.js';
import { createShroudAuctionPrivateState } from '../src/witnesses.js';
import { ShroudAuctionSimulator } from './auction-simulator.js';
import { collectBigInts, randomBytes, serializeLedger, toHex } from './utils.js';

setNetworkId('undeployed');

/** A bidder: an amount, a blinding nonce, and a pseudonym. */
const bidder = (amount: bigint, alias?: Uint8Array) =>
  createShroudAuctionPrivateState(amount, randomBytes(32), alias ?? randomBytes(32));

describe('ShroudAuction smart contract', () => {
  describe('circuit logic', () => {
    it('accepts a sealed bid whose commitment matches the bidder witnesses', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = bidder(100n);
      const commitment = sim.bidCommitment(100n, alice.bidderAlias, alice.bidNonce);

      sim.submitSealedBid(alice, commitment);

      const state = sim.getLedger();
      expect(state.bidCount).toEqual(1n);
      expect(state.sealedBids.size()).toEqual(1n);
      expect(state.sealedBids.member(alice.bidderAlias)).toEqual(true);
      expect(state.sealedBids.lookup(alice.bidderAlias)).toEqual(commitment);
    });

    it('rejects a commitment that does not match the bidder witnesses', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = bidder(100n);
      const wrongCommitment = sim.bidCommitment(
        999n,
        alice.bidderAlias,
        alice.bidNonce,
      );

      // Alice published the hash of 999 but is trying to seal a 100 bid.
      const swapped = createShroudAuctionPrivateState(
        100n,
        alice.bidNonce,
        alice.bidderAlias,
      );
      expect(() => sim.submitSealedBid(swapped, wrongCommitment)).toThrow(
        'failed assert: Commitment does not match the sealed bid',
      );
    });

    it('refuses a second bid from the same pseudonym', () => {
      const sim = new ShroudAuctionSimulator();
      const alias = randomBytes(32);
      const first = bidder(100n, alias);
      const second = bidder(500n, alias);

      sim.submitSealedBid(
        first,
        sim.bidCommitment(100n, first.bidderAlias, first.bidNonce),
      );

      expect(() =>
        sim.submitSealedBid(
          second,
          sim.bidCommitment(500n, second.bidderAlias, second.bidNonce),
        ),
      ).toThrow('failed assert: This pseudonym has already sealed a bid');
    });

    it('computes a deterministic commitment that changes with the amount', () => {
      const sim = new ShroudAuctionSimulator();
      const alias = randomBytes(32);
      const nonce = randomBytes(32);

      const a = sim.bidCommitment(100n, alias, nonce);
      const b = sim.bidCommitment(100n, alias, nonce);
      const differentAmount = sim.bidCommitment(101n, alias, nonce);
      const differentNonce = sim.bidCommitment(100n, alias, randomBytes(32));

      expect(a).toEqual(b);
      expect(a).not.toEqual(differentAmount);
      expect(a).not.toEqual(differentNonce);
      expect(a).toHaveLength(32);
    });
  });

  describe('state transitions', () => {
    it('starts in the bidding phase with an empty book', () => {
      const sim = new ShroudAuctionSimulator();
      const state = sim.getLedger();

      expect(state.phase).toEqual(Phase.Bidding);
      expect(state.bidCount).toEqual(0n);
      expect(state.revealedCount).toEqual(0n);
      expect(state.highestBid).toEqual(0n);
      expect(state.sealedBids.isEmpty()).toEqual(true);
    });

    it('moves Bidding -> Revealing -> Settled once every bid is opened', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = bidder(100n);
      sim.submitSealedBid(
        alice,
        sim.bidCommitment(100n, alice.bidderAlias, alice.bidNonce),
      );

      expect(sim.closeBidding().phase).toEqual(Phase.Revealing);
      expect(sim.revealBid(alice).phase).toEqual(Phase.Revealing);
      expect(sim.settle().phase).toEqual(Phase.Settled);
    });

    it('will not close bidding twice', () => {
      const sim = new ShroudAuctionSimulator();
      sim.closeBidding();
      expect(() => sim.closeBidding()).toThrow(
        'failed assert: Bidding is already closed',
      );
    });

    it('will not reveal a bid while bidding is still open', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = bidder(100n);
      sim.submitSealedBid(
        alice,
        sim.bidCommitment(100n, alice.bidderAlias, alice.bidNonce),
      );

      expect(() => sim.revealBid(alice)).toThrow(
        'failed assert: Bids can only be revealed in the reveal phase',
      );
    });

    it('will not settle while a sealed bid is still unopened', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = bidder(100n);
      const bob = bidder(500n);
      sim.submitSealedBid(
        alice,
        sim.bidCommitment(100n, alice.bidderAlias, alice.bidNonce),
      );
      sim.submitSealedBid(bob, sim.bidCommitment(500n, bob.bidderAlias, bob.bidNonce));
      sim.closeBidding();
      sim.revealBid(alice);

      expect(() => sim.settle()).toThrow(
        'failed assert: Not every sealed bid has been revealed',
      );
    });

    it('empties the sealed bid book as bids are opened', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = bidder(100n);
      sim.submitSealedBid(
        alice,
        sim.bidCommitment(100n, alice.bidderAlias, alice.bidNonce),
      );
      sim.closeBidding();

      expect(sim.getLedger().sealedBids.size()).toEqual(1n);
      sim.revealBid(alice);
      const state = sim.getLedger();
      expect(state.sealedBids.size()).toEqual(0n);
      expect(state.sealedBids.member(alice.bidderAlias)).toEqual(false);
      expect(state.revealedCount).toEqual(1n);
    });
  });

  describe('privacy', () => {
    it('records a sealed bid without putting the amount on-chain', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = bidder(100n);
      const commitment = sim.bidCommitment(
        100n,
        alice.bidderAlias,
        alice.bidNonce,
      );

      sim.submitSealedBid(alice, commitment);
      const state = sim.getLedger();

      // The hash is public...
      expect(serializeLedger(state)).toContain(toHex(commitment));
      // ...but the amount is not, and the auction has no leader yet.
      expect(state.highestBid).toEqual(0n);
      expect(state.highestBidder).toEqual(new Uint8Array(32));
      expect(collectBigInts(state)).not.toContain(100n);
    });

    it('keeps the blinding nonce out of the public ledger', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = bidder(100n);
      sim.submitSealedBid(
        alice,
        sim.bidCommitment(100n, alice.bidderAlias, alice.bidNonce),
      );

      const serialized = serializeLedger(sim.getLedger());
      expect(serialized).not.toContain(toHex(alice.bidNonce));
      // The private state still holds it — it never left the bidder's machine.
      expect(sim.getPrivateState()).toEqual(alice);
    });

    it('publishes the leading amount but never a losing amount', () => {
      const sim = new ShroudAuctionSimulator();

      // Alice bids 500 and takes the lead. Her amount becomes public.
      const alice = bidder(500n);
      // Bob bids 100. His amount must never appear.
      const bob = bidder(100n);

      sim.submitSealedBid(
        alice,
        sim.bidCommitment(500n, alice.bidderAlias, alice.bidNonce),
      );
      sim.submitSealedBid(bob, sim.bidCommitment(100n, bob.bidderAlias, bob.bidNonce));
      sim.closeBidding();

      sim.revealBid(alice);
      let state = sim.getLedger();
      expect(state.highestBid).toEqual(500n);
      expect(state.highestBidder).toEqual(alice.bidderAlias);

      sim.revealBid(bob);
      state = sim.getLedger();

      // Bob's reveal was accepted...
      expect(state.revealedCount).toEqual(2n);
      // ...and changed nothing on-chain about how much he bid.
      expect(state.highestBid).toEqual(500n);
      expect(state.highestBidder).toEqual(alice.bidderAlias);
      expect(state.highestBidder).not.toEqual(bob.bidderAlias);

      // Bob's amount appears nowhere in the ledger, in any field.
      const amounts = collectBigInts(state);
      expect(amounts).not.toContain(100n);
      // The only numbers on-chain are the two counters and Alice's bid.
      // (The phase enum is a plain number, so it is not in this set.)
      expect(state.phase).toEqual(Phase.Revealing);
      expect([...amounts].sort()).toEqual([2n, 2n, 500n].sort());
    });

    it('does not leak a losing bid through the sealed bid book either', () => {
      const sim = new ShroudAuctionSimulator();
      const alice = bidder(500n);
      const bob = bidder(100n);

      sim.submitSealedBid(
        alice,
        sim.bidCommitment(500n, alice.bidderAlias, alice.bidNonce),
      );
      sim.submitSealedBid(bob, sim.bidCommitment(100n, bob.bidderAlias, bob.bidNonce));
      sim.closeBidding();
      sim.revealBid(alice);
      sim.revealBid(bob);

      const serialized = serializeLedger(sim.getLedger());
      expect(serialized).not.toContain(toHex(bob.bidNonce));
      // Bob's pseudonym is gone from the ledger once his bid is opened, so it
      // is not even possible to tell that the 100 bid belonged to him.
      expect(sim.getLedger().sealedBids.member(bob.bidderAlias)).toEqual(false);
    });
  });
});
