/**
 * Building a Midnight.js provider bundle from a connected DApp Connector wallet.
 *
 * This is the piece that makes a browser DApp possible: instead of a local
 * wallet-sdk (Node-only) and a local proof server, the page asks the wallet to
 * (a) delegate proving to its proving provider and (b) balance and submit the
 * transaction. Everything the app itself needs — indexer access, private state,
 * ZK artifacts — is assembled here.
 */

import type { ConnectedAPI, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import { dappConnectorProvingProvider } from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { createProofProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  parseCoinPublicKeyToHex,
  parseEncPublicKeyToHex,
  fromHex,
  toHex,
} from '@midnight-ntwrk/midnight-js-utils';

import {
  FALLBACK_INDEXER_URL,
  FALLBACK_INDEXER_WS_URL,
  NETWORK_ID,
  PRIVATE_STATE_STORE,
  ZK_ARTIFACTS_PATH,
} from '../config';

export type WalletErrorCode =
  | 'not-installed'
  | 'rejected'
  | 'network-mismatch'
  | 'no-proving-support'
  | 'unknown';

/** Errors the wallet UI can turn into a specific, actionable message. */
export class WalletError extends Error {
  constructor(
    readonly code: WalletErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

/** A wallet as injected into `window.midnight`, including the legacy `enable()` shape. */
type InjectedWallet = InitialAPI & {
  enable?: () => Promise<ConnectedAPI>;
  isEnabled?: () => Promise<boolean>;
};

/** Every wallet the browser has injected under `window.midnight`. */
export function listInjectedWallets(): Array<[string, InjectedWallet]> {
  const midnight = (globalThis as { midnight?: Record<string, InjectedWallet> }).midnight;
  if (!midnight || typeof midnight !== 'object') return [];
  return Object.entries(midnight).filter(
    (entry): entry is [string, InjectedWallet] => !!entry[1] && typeof entry[1] === 'object',
  );
}

/**
 * Connect to an injected Midnight wallet.
 *
 * Supports both connector shapes: v4 wallets expose `connect(networkId)`, while
 * 1.x–3.x wallets expose `enable()`. Lace is preferred when present; otherwise
 * the first injected wallet is used.
 */
export async function connectWallet(
  networkId: string = NETWORK_ID,
): Promise<{ walletKey: string; api: ConnectedAPI }> {
  const wallets = listInjectedWallets();
  if (wallets.length === 0) {
    throw new WalletError(
      'not-installed',
      'No Midnight wallet detected. Install the Lace extension (with Midnight support) and reload.',
    );
  }

  const preferred =
    wallets.find(([key]) => key.toLowerCase().includes('lace')) ?? wallets[0];
  const [walletKey, wallet] = preferred;

  try {
    const api =
      typeof wallet.connect === 'function'
        ? await wallet.connect(networkId)
        : typeof wallet.enable === 'function'
          ? await wallet.enable()
          : null;

    if (!api) {
      throw new WalletError(
        'not-installed',
        `The injected wallet "${walletKey}" exposes neither connect() nor enable().`,
      );
    }
    return { walletKey, api };
  } catch (cause) {
    if (cause instanceof WalletError) throw cause;
    const reason = (cause as { reason?: string })?.reason ?? (cause as Error)?.message ?? String(cause);
    throw new WalletError('rejected', `Wallet connection was not granted: ${reason}`, cause);
  }
}

/** A Midnight.js `WalletProvider`/`MidnightProvider` backed by the connector. */
export interface ConnectorWalletProvider {
  getCoinPublicKey(): string;
  getEncryptionPublicKey(): string;
  balanceTx(tx: any, ttl?: Date): Promise<any>;
  submitTx(tx: any): Promise<string>;
}

/**
 * Adapt the connector's transaction methods to the Midnight.js wallet provider.
 *
 * Transactions cross the extension boundary as serialized strings: the ledger
 * object is serialized before the call and the balanced result is deserialized
 * back into a ledger object. `submitTx` returns one of the transaction's
 * identifiers, which is what `MidnightProvider.submitTx` resolves to.
 */
function createConnectorWalletProvider(
  api: ConnectedAPI,
  coinPublicKey: string,
  encryptionPublicKey: string,
): ConnectorWalletProvider {
  return {
    getCoinPublicKey: () => coinPublicKey,
    getEncryptionPublicKey: () => encryptionPublicKey,

    async balanceTx(tx: any, _ttl?: Date) {
      const serialized = toHex(tx.serialize() as Uint8Array);
      const balanced = await api.balanceUnsealedTransaction(serialized as never);
      const bytes = fromHex((balanced as { tx: string }).tx);
      // Transaction<SignatureEnabled, Proof, Binding> — the sealed, balanced shape.
      return (Transaction.deserialize as any)('signature', 'proof', 'binding', bytes);
    },

    async submitTx(tx: any) {
      const serialized = toHex(tx.serialize() as Uint8Array);
      await api.submitTransaction(serialized as never);
      const ids: string[] = tx.identifiers();
      return ids[0];
    },
  };
}

/** The provider bundle `findDeployedContract` expects. */
export interface AuctionProviders {
  privateStateProvider: ReturnType<typeof levelPrivateStateProvider>;
  publicDataProvider: ReturnType<typeof indexerPublicDataProvider>;
  zkConfigProvider: FetchZkConfigProvider<string>;
  proofProvider: ReturnType<typeof createProofProvider>;
  walletProvider: ConnectorWalletProvider;
  midnightProvider: ConnectorWalletProvider;
}

export interface ProviderContext {
  providers: AuctionProviders;
  /** The wallet's shielded address, used to scope private state. */
  shieldedAddress: string;
  /** The chain's reported network id, from `getConfiguration()`. */
  witnessedNetworkId: string | null;
}

/**
 * Assemble the provider bundle for a connected wallet.
 *
 * The wallet's own `getConfiguration()` is preferred for the indexer endpoints,
 * so a user who pointed Lace at a custom indexer is respected; the built-in
 * defaults only apply if the wallet does not answer.
 */
export async function createAuctionProviders(api: ConnectedAPI): Promise<ProviderContext> {
  setNetworkId(NETWORK_ID as never);

  // Ask the wallet up-front what we intend to use, so it can prompt for any
  // permissions it wants before the first transaction.
  try {
    await (api as any).hintUsage?.([
      'getProvingProvider',
      'getShieldedAddresses',
      'getConfiguration',
      'balanceUnsealedTransaction',
      'submitTransaction',
    ]);
  } catch {
    // Optional — older wallets do not implement hintUsage.
  }

  // ── Network check ────────────────────────────────────────────────────────
  const configuration = await api.getConfiguration().catch(() => null);
  const witnessedNetworkId = configuration?.networkId ?? null;
  if (witnessedNetworkId && !witnessedNetworkId.toLowerCase().includes(NETWORK_ID)) {
    throw new WalletError(
      'network-mismatch',
      `This dApp targets ${NETWORK_ID}, but the wallet is connected to ${witnessedNetworkId}. ` +
        'Switch the network in Lace and reconnect.',
    );
  }

  // ── Public data (indexer) ────────────────────────────────────────────────
  const publicDataProvider = indexerPublicDataProvider(
    configuration?.indexerUri || FALLBACK_INDEXER_URL,
    configuration?.indexerWsUri || FALLBACK_INDEXER_WS_URL,
  );

  // ── ZK artifacts (keys + zkir), fetched from our own origin ───────────────
  const zkConfigProvider = new FetchZkConfigProvider<string>(
    new URL(`${ZK_ARTIFACTS_PATH}/`, window.location.origin).toString(),
    window.fetch.bind(window) as never,
  );

  // ── Wallet keys ──────────────────────────────────────────────────────────
  const addresses = await api.getShieldedAddresses();
  const shieldedAddress = addresses.shieldedAddress;
  const coinPublicKey = parseCoinPublicKeyToHex(addresses.shieldedCoinPublicKey, NETWORK_ID as never);
  const encryptionPublicKey = parseEncPublicKeyToHex(
    addresses.shieldedEncryptionPublicKey,
    NETWORK_ID as never,
  );

  // ── Private state (browser storage, scoped to this wallet) ────────────────
  const privateStateProvider = levelPrivateStateProvider({
    privateStateStoreName: PRIVATE_STATE_STORE,
    accountId: shieldedAddress,
    // The SDK enforces a minimum-strength password. Deriving it from the public
    // address keeps it stable across reloads without asking the user.
    privateStoragePasswordProvider: () => `shroudauction-local-${shieldedAddress.slice(0, 24)}`,
  });

  // ── Proving: delegated to the wallet's proving provider ───────────────────
  if (typeof (api as any).getProvingProvider !== 'function') {
    throw new WalletError(
      'no-proving-support',
      'This wallet does not support delegated proving (getProvingProvider). Update Lace to a v4-compatible build.',
    );
  }
  const provingProvider = await dappConnectorProvingProvider(
    api as never,
    zkConfigProvider as never,
  );
  const proofProvider = createProofProvider(provingProvider as never);

  // ── Balances + submission: the wallet pays fees and relays ────────────────
  const walletProvider = createConnectorWalletProvider(api, coinPublicKey, encryptionPublicKey);

  return {
    providers: {
      privateStateProvider: privateStateProvider as AuctionProviders['privateStateProvider'],
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider: walletProvider,
    },
    shieldedAddress,
    witnessedNetworkId,
  };
}
