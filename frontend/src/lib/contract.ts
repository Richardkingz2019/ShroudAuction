/**
 * Loading the compiled ShroudAuction contract in the browser.
 *
 * `scripts/sync-artifacts.mjs` copies the compiler output into
 * `src/generated/auction-contract/index.js`. It is imported through Vite (not
 * served raw from public/) so that its `@midnight-ntwrk/compact-runtime` import
 * is bundled rather than left as a bare specifier the browser cannot resolve.
 */

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

import { CONTRACT_NAME, ZK_ARTIFACTS_PATH } from '../config';
import { witnesses } from './witnesses';

/**
 * The compiled contract module, typed from its own generated declaration rather
 * than hand-written, so the ledger shape here cannot drift from the compiler
 * output. `src/generated/` is excluded from the tsconfig `include`, but types
 * are still resolved for imports like this one.
 */
export type CompiledAuctionModule = typeof import('../generated/auction-contract/index.js');

/** The decoded public ledger, exactly as the generated `ledger()` returns it. */
export type AuctionLedger = import('../generated/auction-contract/index.js').Ledger;

let cached: Promise<CompiledAuctionModule> | null = null;

/** Import the compiled contract once and reuse it. */
export function loadCompiledAuction(): Promise<CompiledAuctionModule> {
  cached ??= import('../generated/auction-contract/index.js');
  return cached;
}

/**
 * Bind the witnesses to the compiled contract. The `withCompiledFileAssets`
 * argument is the artifacts path the Node scripts use; the DApp-connector proof
 * provider sources its key material from the `zkConfigProvider` instead, so the
 * value here only needs to be present to satisfy the type.
 */
export function makeCompiledAuctionContract(Contract: unknown): unknown {
  return (CompiledContract.make as any)(CONTRACT_NAME, Contract).pipe(
    (CompiledContract.withWitnesses as any)(witnesses),
    (CompiledContract.withCompiledFileAssets as any)(ZK_ARTIFACTS_PATH),
  );
}

export const PHASE_NAMES = ['Bidding', 'Revealing', 'Settled'] as const;

export function phaseName(phase: number): string {
  return PHASE_NAMES[phase] ?? 'Unknown';
}
