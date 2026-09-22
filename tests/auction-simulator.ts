/**
 * Runs the ShroudAuction contract locally, with no network and no proof server.
 *
 * This is the same generated contract class the deploy scripts load, driven
 * through the Compact runtime directly, so a test that passes here is exercising
 * the real circuit logic rather than a reimplementation of it.
 */

import {
  CostModel,
  QueryContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  type Ledger,
} from '../contracts/managed/auction/contract/index.js';
import {
  createShroudAuctionPrivateState,
  witnesses,
  type ShroudAuctionPrivateState,
} from '../src/witnesses.js';

/**
 * The coin public key the simulator presents as the transaction submitter,
 * hex-encoded the way the runtime expects it. The contract records it as the
 * auctioneer at construction time, and the same value travels into every
 * circuit context, which is what lets closeBidding()/settle() satisfy their
 * `ownPublicKey() == auctioneer` checks.
 */
const SUBMITTER_COIN_PUBLIC_KEY = '0'.repeat(64);

export class ShroudAuctionSimulator {
  readonly contract: Contract<ShroudAuctionPrivateState>;
  circuitContext: CircuitContext<ShroudAuctionPrivateState>;

  constructor(
    privateState: ShroudAuctionPrivateState = createShroudAuctionPrivateState(
      0n,
      new Uint8Array(32),
      new Uint8Array(32),
    ),
  ) {
    this.contract = new Contract<ShroudAuctionPrivateState>(witnesses);

    // The constructor's Zswap local state carries the caller's coin public key,
    // and it is reused for every circuit call so ownPublicKey() stays stable.
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(privateState, SUBMITTER_COIN_PUBLIC_KEY),
      );

    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  /** Act as a different bidder: swap in that bidder's private state. */
  setPrivateState(privateState: ShroudAuctionPrivateState): void {
    this.circuitContext = { ...this.circuitContext, currentPrivateState: privateState };
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  getPrivateState(): ShroudAuctionPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  /** Off-circuit helper the bidder uses to compute the hash they publish. */
  bidCommitment(amount: bigint, alias: Uint8Array, nonce: Uint8Array): Uint8Array {
    return this.contract.circuits.bidCommitment(
      this.circuitContext,
      amount,
      alias,
      nonce,
    ).result;
  }

  submitSealedBid(
    privateState: ShroudAuctionPrivateState,
    commitment: Uint8Array,
  ): Ledger {
    this.setPrivateState(privateState);
    this.circuitContext = this.contract.impureCircuits.submitSealedBid(
      this.circuitContext,
      commitment,
    ).context;
    return this.getLedger();
  }

  closeBidding(): Ledger {
    this.circuitContext = this.contract.impureCircuits.closeBidding(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  revealBid(privateState: ShroudAuctionPrivateState): Ledger {
    this.setPrivateState(privateState);
    this.circuitContext = this.contract.impureCircuits.revealBid(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  settle(): Ledger {
    this.circuitContext = this.contract.impureCircuits.settle(this.circuitContext).context;
    return this.getLedger();
  }
}
