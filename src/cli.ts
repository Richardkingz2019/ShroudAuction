/**
 * CLI for interacting with a deployed ShroudAuction contract.
 *
 * The bidder's amount, blinding nonce and pseudonym are kept in the private
 * state store, so they survive between runs: seal a bid now, close your laptop,
 * come back later and reveal it.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { WebSocket } from 'ws';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import {
  PRIVATE_STATE_ID,
  PRIVATE_STATE_STORE,
  createShroudAuctionPrivateState,
  loadCompiledAuction,
  makeCompiledAuctionContract,
  zkConfigPath,
  type ShroudAuctionPrivateState,
} from './auction-contract';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

const { Contract, ledger: decodeLedger, pureCircuits } = await loadCompiledAuction();
const compiledContract = makeCompiledAuctionContract(Contract);

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
  // The SDK requires the private-state password to be at least 16 characters.
  const privateStatePassword =
    process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: walletCtx.shieldedSecretKeys,
          dustSecretKey: walletCtx.dustSecretKey,
        },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE,
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

const randomBytes = (n: number): Uint8Array => {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

// ─── Main CLI ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    ShroudAuction CLI                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const rl = createInterface({ input: stdin, output: stdout });

  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(
      `No deploy on file for network ${network}. Run \`npm run setup -- --network ${network}\` first.`,
    );
    process.exit(1);
  }
  console.log(`  Contract: ${deployment.address}`);
  console.log(`  Network: ${network}\n`);

  try {
    console.log('  Connecting to wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(
        `  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`,
      );
    }

    console.log('  Syncing with network...');
    console.log('  ℹ  This may take several minutes depending on network size.');
    console.log(
      '     RPC disconnection messages during sync are normal and can be safely ignored.\n',
    );
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    await persistWalletState(network, walletCtx);
    const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

    if (balance === 0n && network !== 'undeployed' && networkConfig.faucet) {
      const address = walletCtx.unshieldedKeystore.getBech32Address();
      console.log('  ⚠ Wallet has no tNight. Fund it from the faucet to send transactions:');
      console.log(`     ${networkConfig.faucet}`);
      console.log(`     Wallet address: ${address}\n`);
    }

    console.log('  Connecting to contract...');
    const providers = await createProviders(walletCtx);

    const deployed: any = await findDeployedContract(providers, {
      compiledContract: compiledContract as any,
      contractAddress: deployment.address,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: createShroudAuctionPrivateState(
        0n,
        randomBytes(32),
        randomBytes(32),
      ),
    });

    console.log('  ✅ Connected!\n');

    /** Read the auction's public state straight off the chain. */
    const readAuctionState = async () => {
      const contractState = await providers.publicDataProvider.queryContractState(
        deployment.address,
      );
      if (!contractState) return null;
      return decodeLedger(contractState.data);
    };

    const showAuctionState = async () => {
      const auction = await readAuctionState();
      if (!auction) {
        console.log('\n  📋 No contract state found.\n');
        return;
      }
      const phaseName = ['Bidding', 'Revealing', 'Settled'][auction.phase as number] ?? '?';
      console.log('\n  ── Public auction state ──────────────────────────────');
      console.log(`  Phase:          ${phaseName}`);
      console.log(`  Sealed bids:    ${auction.bidCount}`);
      console.log(`  Opened bids:    ${auction.revealedCount}`);
      console.log(`  Unopened:       ${auction.sealedBids.size()}`);
      console.log(
        `  Highest bid:    ${auction.highestBid === 0n ? '(none yet)' : auction.highestBid}`,
      );
      console.log(`  Leading bidder: ${hex(auction.highestBidder)}`);
      console.log(`  Auctioneer:     ${hex(auction.auctioneer.bytes)}`);
      console.log(
        '  ⓘ Losing bid amounts are not in this listing — they are never written on-chain.\n',
      );
    };

    let running = true;
    while (running) {
      console.log('─── Menu ───────────────────────────────────────────────────────');
      console.log('  1. Seal a bid (private amount)');
      console.log('  2. Close bidding (auctioneer)');
      console.log('  3. Reveal my sealed bid');
      console.log('  4. Settle the auction (auctioneer)');
      console.log('  5. Show public auction state');
      console.log('  6. Check wallet balance');
      console.log('  7. Exit\n');

      const choice = await rl.question('  Your choice: ');

      switch (choice.trim()) {
        case '1': {
          const raw = await rl.question('  Bid amount (private, never published): ');
          let amount: bigint;
          try {
            amount = BigInt(raw.trim());
          } catch {
            console.log('\n  ❌ Enter a whole number.\n');
            break;
          }
          if (amount <= 0n) {
            console.log('\n  ❌ The bid must be greater than zero.\n');
            break;
          }

          // The pseudonym identifies the bid in the public book without tying it
          // to this wallet. It stays in the private state for the reveal later.
          const existing = (await providers.privateStateProvider.get(
            PRIVATE_STATE_ID,
          )) as ShroudAuctionPrivateState | null;
          const alias = existing?.bidderAlias ?? randomBytes(32);
          const nonce = randomBytes(32);
          const privateState = createShroudAuctionPrivateState(amount, nonce, alias);
          const commitment = pureCircuits.bidCommitment(amount, alias, nonce);

          console.log(`\n  Commitment (this is all that goes on-chain): ${hex(commitment)}`);
          console.log('  Submitting transaction (this may take 30-60 seconds)...');
          try {
            await providers.privateStateProvider.set(PRIVATE_STATE_ID, privateState);
            const tx = await deployed.callTx.submitSealedBid(commitment);
            console.log(`\n  ✅ Sealed bid submitted.`);
            console.log(`  Transaction ID: ${tx.public.txId}`);
            console.log(`  Block height: ${tx.public.blockHeight}`);
            console.log('  Your amount and nonce are stored locally for the reveal.\n');
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '2': {
          console.log('\n  Closing bidding...');
          try {
            const tx = await deployed.callTx.closeBidding();
            console.log(`\n  ✅ Bidding closed. Auction is now in the reveal phase.`);
            console.log(`  Transaction ID: ${tx.public.txId}\n`);
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '3': {
          console.log('\n  Opening your sealed bid...');
          try {
            const tx = await deployed.callTx.revealBid();
            console.log(`\n  ✅ Bid revealed.`);
            console.log(`  Transaction ID: ${tx.public.txId}\n`);
            await showAuctionState();
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '4': {
          console.log('\n  Settling the auction...');
          try {
            const tx = await deployed.callTx.settle();
            console.log(`\n  ✅ Auction settled.`);
            console.log(`  Transaction ID: ${tx.public.txId}\n`);
            await showAuctionState();
          } catch (error) {
            console.error('\n  ❌ Failed:', error instanceof Error ? error.message : error);
          }
          break;
        }

        case '5':
          await showAuctionState();
          break;

        case '6': {
          console.log('\n  Checking balance...');
          const currentState = await walletCtx.wallet.waitForSyncedState();
          const currentBalance = currentState.unshielded.balances[unshieldedToken().raw] ?? 0n;
          const dustBalance = currentState.dust.balance(new Date());
          console.log(`\n  tNight: ${currentBalance.toLocaleString()}`);
          console.log(`  DUST:   ${dustBalance.toLocaleString()}\n`);
          break;
        }

        case '7':
          running = false;
          console.log('\n  👋 Goodbye!\n');
          break;

        default:
          console.log('\n  ❌ Invalid choice. Please enter 1-7.\n');
      }
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
  } finally {
    rl.close();
  }
}

main().catch(console.error);
