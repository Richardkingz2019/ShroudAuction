/**
 * Frontend configuration.
 *
 * Everything that differs between networks or deployments is read from Vite env
 * vars (`import.meta.env.VITE_*`) so the same bundle can point at Preview or
 * Preprod without a rebuild. Defaults target Preprod, which is what the Level 2
 * challenge asks for.
 */

export type NetworkId = 'preprod' | 'preview' | 'undeployed';

const env = import.meta.env;

export const NETWORK_ID: NetworkId = (env.VITE_NETWORK_ID ?? 'preprod') as NetworkId;

/**
 * The on-chain contract this app talks to.
 *
 * Exposed through an env var on purpose: the contract address is a deployment
 * fact, not a source fact. See .env.example for the caveat about the Bech32m
 * Preprod value supplied for the challenge.
 */
export const CONTRACT_ADDRESS: string =
  env.VITE_CONTRACT_ADDRESS ?? 'mn_addr_preprod1yms6jevlk8pvsgv9r4aphjdr283qf3v6yg8lt50vl3yzunn2zh9stxvytv';

/**
 * Indexer endpoints used only until a wallet connects. A connected wallet's
 * `getConfiguration()` is preferred, because the user may have configured their
 * own indexer in Lace and we should respect that.
 */
export const FALLBACK_INDEXER_URL: string =
  env.VITE_INDEXER_URL ?? 'https://indexer.preprod.midnight.network/api/v4/graphql';

export const FALLBACK_INDEXER_WS_URL: string =
  env.VITE_INDEXER_WS_URL ?? 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';

/**
 * Where the ZK artifacts are served from, relative to the site root. The sync
 * script writes `public/contracts/auction/{keys,zkir}` and Vercel serves
 * `public/` at `/`, so the provider fetches
 * `${origin}/contracts/auction/zkir/<circuit>.bzkir`.
 */
export const ZK_ARTIFACTS_PATH = 'contracts/auction';

/** Must match PRIVATE_STATE_ID in the repo root's src/auction-contract.ts. */
export const PRIVATE_STATE_ID = 'shroudAuctionPrivateState';

/** IndexedDB/localStorage store name for the bidder's private state. */
export const PRIVATE_STATE_STORE = 'shroudauction-state';

/** The circuits this contract exposes, in the order the UI presents them. */
export const CONTRACT_NAME = 'ShroudAuction';
