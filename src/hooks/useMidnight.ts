/**
 * useMidnight — the single hook the UI talks to.
 *
 * It owns the wallet connection, the Midnight.js provider bundle, the handle to
 * the deployed contract, and the public auction state. Circuit calls go through
 * `callCircuit`, which keeps proof generation explicit so the UI can show a
 * loading state while the wallet proves.
 *
 * Privacy rule enforced here: a bid amount is accepted as an argument, written
 * straight into the private state store, and never returned or stored in React
 * state. The only things that leave this hook are public values (the
 * commitment, a transaction id, the ledger snapshot).
 */

import { useCallback, useRef, useState } from 'react';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import {
  CONTRACT_ADDRESS,
  NETWORK_ID,
  PRIVATE_STATE_ID,
  type NetworkId,
} from '../config';
import {
  loadCompiledAuction,
  makeCompiledAuctionContract,
  phaseName,
  type AuctionLedger,
} from '../lib/contract';
import {
  connectWallet,
  createAuctionProviders,
  listInjectedWallets,
  WalletError,
  type ProviderContext,
} from '../lib/providers';
import {
  createEmptyPrivateState,
  createShroudAuctionPrivateState,
  randomBytes,
  toHex,
} from '../lib/witnesses';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export type CircuitName =
  | 'submitSealedBid'
  | 'revealBid'
  | 'closeBidding'
  | 'settle';

export interface CircuitResult {
  circuit: CircuitName;
  label: string;
  txId: string;
  blockHeight?: number;
  at: string;
  /** Public value produced by the call, if any. Never a private input. */
  detail?: string;
}

export interface AuctionSnapshot {
  phase: number;
  phaseLabel: string;
  bidCount: number;
  revealedCount: number;
  unopened: number;
  highestBid: bigint;
  highestBidder: string;
  auctioneer: string;
}

export interface UseMidnight {
  status: ConnectionStatus;
  error: string | null;
  walletName: string | null;
  walletAddress: string | null;
  networkId: NetworkId;
  contractAddress: string;

  auction: AuctionSnapshot | null;
  auctionError: string | null;

  /** Set while a proof is being generated / a transaction is in flight. */
  pendingCircuit: CircuitName | null;
  history: CircuitResult[];

  connect: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;

  /** The amount is private; it is consumed, not stored. */
  sealBid: (amount: bigint) => Promise<CircuitResult | null>;
  revealBid: () => Promise<CircuitResult | null>;
  closeBidding: () => Promise<CircuitResult | null>;
  settle: () => Promise<CircuitResult | null>;
}

const CIRCUIT_LABELS: Record<CircuitName, string> = {
  submitSealedBid: 'Sealed a bid',
  revealBid: 'Revealed a bid',
  closeBidding: 'Closed bidding',
  settle: 'Settled the auction',
};

function decodeLedger(ledger: AuctionLedger): AuctionSnapshot {
  return {
    phase: ledger.phase,
    phaseLabel: phaseName(ledger.phase),
    bidCount: Number(ledger.bidCount),
    revealedCount: Number(ledger.revealedCount),
    unopened: Number(ledger.sealedBids.size()),
    highestBid: ledger.highestBid,
    highestBidder: toHex(ledger.highestBidder),
    auctioneer: toHex(ledger.auctioneer.bytes),
  };
}

export function useMidnight(): UseMidnight {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const [auction, setAuction] = useState<AuctionSnapshot | null>(null);
  const [auctionError, setAuctionError] = useState<string | null>(null);

  const [pendingCircuit, setPendingCircuit] = useState<CircuitName | null>(null);
  const [history, setHistory] = useState<CircuitResult[]>([]);

  // Refs hold the live objects so async callbacks never read a stale closure.
  const providersRef = useRef<ProviderContext | null>(null);
  const contractRef = useRef<any>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);

  const message = (err: unknown): string => {
    if (err instanceof WalletError) return err.message;
    if (err instanceof Error) return err.message;
    return String(err);
  };

  const readAuction = useCallback(async (): Promise<AuctionSnapshot | null> => {
    const ctx = providersRef.current;
    if (!ctx) return null;
    const { ledger } = await loadCompiledAuction();
    const contractState = await ctx.providers.publicDataProvider.queryContractState(
      CONTRACT_ADDRESS,
    );
    if (!contractState) return null;
    return decodeLedger(ledger(contractState.data));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setAuctionError(null);
      const snapshot = await readAuction();
      setAuction(snapshot);
      if (!snapshot) {
        setAuctionError(
          `No contract state found at ${CONTRACT_ADDRESS} on ${NETWORK_ID}. ` +
            'Check that the address is a deployed contract on this network.',
        );
      }
    } catch (err) {
      setAuctionError(message(err));
    }
  }, [readAuction]);

  const connect = useCallback(async () => {
    if (connectPromiseRef.current) return connectPromiseRef.current;

    const run = (async () => {
      setStatus('connecting');
      setError(null);
      try {
        if (listInjectedWallets().length === 0) {
          throw new WalletError(
            'not-installed',
            'No Midnight wallet detected. Install the Lace extension and reload this page.',
          );
        }

        const { walletKey, api } = await connectWallet(NETWORK_ID);
        const ctx = await createAuctionProviders(api);

        const { Contract } = await loadCompiledAuction();
        const compiledContract = makeCompiledAuctionContract(Contract);

        const deployed: any = await findDeployedContract(ctx.providers as any, {
          compiledContract: compiledContract as any,
          contractAddress: CONTRACT_ADDRESS,
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState: createEmptyPrivateState(),
        });

        providersRef.current = ctx;
        contractRef.current = deployed;
        setWalletName(walletKey);
        setWalletAddress(ctx.shieldedAddress);
        setStatus('connected');
        await refresh();
      } catch (err) {
        providersRef.current = null;
        contractRef.current = null;
        setError(message(err));
        setStatus('error');
      }
    })();

    connectPromiseRef.current = run;
    try {
      await run;
    } finally {
      connectPromiseRef.current = null;
    }
  }, [refresh]);

  const disconnect = useCallback(() => {
    providersRef.current = null;
    contractRef.current = null;
    setWalletName(null);
    setWalletAddress(null);
    setAuction(null);
    setAuctionError(null);
    setError(null);
    setHistory([]);
    setStatus('idle');
  }, []);

  /** Run a circuit with the loading state and history bookkeeping. */
  const runCircuit = useCallback(
    async (
      circuit: CircuitName,
      invoke: (contract: any) => Promise<any>,
      detail?: string,
    ): Promise<CircuitResult | null> => {
      const contract = contractRef.current;
      if (!contract) {
        setError('Connect a wallet first.');
        return null;
      }

      setPendingCircuit(circuit);
      setError(null);
      try {
        const tx = await invoke(contract);
        const pub = tx?.public ?? {};
        const result: CircuitResult = {
          circuit,
          label: CIRCUIT_LABELS[circuit],
          txId: pub.txId ?? '(unknown)',
          blockHeight: pub.blockHeight,
          at: new Date().toISOString(),
          detail,
        };
        setHistory((prev) => [result, ...prev].slice(0, 12));
        await refresh();
        return result;
      } catch (err) {
        setError(message(err));
        return null;
      } finally {
        setPendingCircuit(null);
      }
    },
    [refresh],
  );

  const sealBid = useCallback(
    async (amount: bigint): Promise<CircuitResult | null> => {
      const ctx = providersRef.current;
      const { pureCircuits } = await loadCompiledAuction();
      if (!ctx) {
        setError('Connect a wallet first.');
        return null;
      }
      if (amount <= 0n) {
        setError('The bid must be greater than zero.');
        return null;
      }

      // The pseudonym is reused across a session so a bidder can reveal their
      // own bid later; the nonce is fresh per bid. The empty placeholder state
      // uses an all-zero alias — that means "not chosen yet", not "use zeroes",
      // because two bidders sharing a pseudonym would correlate their bids.
      const existing = (await ctx.providers.privateStateProvider.get(
        PRIVATE_STATE_ID,
      )) as { bidderAlias?: Uint8Array } | null;
      const storedAlias = existing?.bidderAlias;
      const alias =
        storedAlias && storedAlias.some((byte) => byte !== 0) ? storedAlias : randomBytes(32);
      const nonce = randomBytes(32);

      // Compute the commitment locally (a pure circuit — no proof, no network).
      const commitment = pureCircuits.bidCommitment(amount, alias, nonce);

      // Write the private state, then discard the amount. It is not returned,
      // logged, or stored in React state.
      await ctx.providers.privateStateProvider.set(
        PRIVATE_STATE_ID,
        createShroudAuctionPrivateState(amount, nonce, alias),
      );

      return runCircuit(
        'submitSealedBid',
        (contract) => contract.callTx.submitSealedBid(commitment),
        `commitment ${toHex(commitment)}`,
      );
    },
    [runCircuit],
  );

  const revealBid = useCallback(
    () => runCircuit('revealBid', (contract) => contract.callTx.revealBid()),
    [runCircuit],
  );

  const closeBidding = useCallback(
    () => runCircuit('closeBidding', (contract) => contract.callTx.closeBidding()),
    [runCircuit],
  );

  const settle = useCallback(
    () => runCircuit('settle', (contract) => contract.callTx.settle()),
    [runCircuit],
  );

  return {
    status,
    error,
    walletName,
    walletAddress,
    networkId: NETWORK_ID,
    contractAddress: CONTRACT_ADDRESS,
    auction,
    auctionError,
    pendingCircuit,
    history,
    connect,
    disconnect,
    refresh,
    sealBid,
    revealBid,
    closeBidding,
    settle,
  };
}
