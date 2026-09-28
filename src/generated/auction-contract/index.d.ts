import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Phase { Bidding = 0, Revealing = 1, Settled = 2 }

export type Witnesses<PS> = {
  bidAmount(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  bidNonce(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  bidderAlias(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  submitSealedBid(context: __compactRuntime.CircuitContext<PS>,
                  commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeBidding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  revealBid(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  settle(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  submitSealedBid(context: __compactRuntime.CircuitContext<PS>,
                  commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeBidding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  revealBid(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  settle(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  bidCommitment(amount_0: bigint, alias_0: Uint8Array, nonce_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  bidCommitment(context: __compactRuntime.CircuitContext<PS>,
                amount_0: bigint,
                alias_0: Uint8Array,
                nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  submitSealedBid(context: __compactRuntime.CircuitContext<PS>,
                  commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeBidding(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  revealBid(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  settle(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly phase: Phase;
  readonly auctioneer: { bytes: Uint8Array };
  readonly bidCount: bigint;
  sealedBids: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  readonly revealedCount: bigint;
  readonly highestBid: bigint;
  readonly highestBidder: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
