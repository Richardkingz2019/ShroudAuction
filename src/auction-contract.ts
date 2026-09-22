/**
 * Shared plumbing for the ShroudAuction contract: where the compiled artifacts
 * live, how the witnesses get attached, and the identifier the private state is
 * stored under.
 *
 * deploy.ts, cli.ts and scripts/e2e-check.ts all need the same three things, and
 * they must agree on them exactly — a mismatched privateStateId means a
 * transaction that silently can't find the bidder's private state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { Contract as AuctionContractClass } from '../contracts/managed/auction/contract/index.js';
import {
  createShroudAuctionPrivateState,
  witnesses,
  type ShroudAuctionPrivateState,
} from './witnesses';

export const CONTRACT_NAME = 'ShroudAuction';

/** Must match everywhere the contract is opened. */
export const PRIVATE_STATE_ID = 'shroudAuctionPrivateState';

/** LevelDB store name for the private state. */
export const PRIVATE_STATE_STORE = 'shroudauction-state';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where `npm run compile` writes the circuits, keys and zkir. */
export const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', 'auction');

/**
 * Load the compiler output. Imported dynamically rather than statically because
 * contracts/managed/ is generated and gitignored: a fresh clone that has not run
 * `npm run compile` must fail with a readable message, not a module-resolution
 * stack trace.
 */
export async function loadCompiledAuction(): Promise<{
  Contract: any;
  ledger: (state: any) => any;
  Phase: any;
  /** Pure circuits can be run locally with no context and no proof. */
  pureCircuits: { bidCommitment(amount: bigint, alias: Uint8Array, nonce: Uint8Array): Uint8Array };
}> {
  const contractPath = path.join(zkConfigPath, 'contract', 'index.js');
  if (!fs.existsSync(contractPath)) {
    console.error('\n❌ Contract not compiled! Run: npm run compile\n');
    process.exit(1);
  }
  return (await import(pathToFileURL(contractPath).href)) as any;
}

/**
 * Attach this project's witnesses to the compiled contract, so the SDK can run
 * the circuits that read the bidder's private state.
 */
export function makeCompiledAuctionContract(Contract: typeof AuctionContractClass) {
  return CompiledContract.make<AuctionContractClass<ShroudAuctionPrivateState>>(
    CONTRACT_NAME,
    Contract<ShroudAuctionPrivateState>,
  ).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );
}

/**
 * Private state used when the contract is first deployed. The deployer is the
 * auctioneer, and the auctioneer never bids, so these values are placeholders —
 * they are never opened against a commitment.
 */
export function createAuctioneerPrivateState(): ShroudAuctionPrivateState {
  return createShroudAuctionPrivateState(0n, new Uint8Array(32), new Uint8Array(32));
}

export { createShroudAuctionPrivateState, witnesses };
export type { ShroudAuctionPrivateState };
