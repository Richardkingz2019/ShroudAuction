/**
 * Check wallet balance on the local Midnight devnet
 */
import { WebSocket } from 'ws';

// Midnight SDK imports
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, getDeployment } from './network';
// unshieldedToken is re-exported from ./wallet (originally @midnight-ntwrk/midnight-js-protocol/ledger).
import { createWallet, persistWalletState, unshieldedToken } from './wallet';

// Enable WebSocket for GraphQL subscriptions
// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// ─── Network configuration ─────────────────────────────────────────────────────

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

// --no-sync prints the wallet's address and stops there. The address comes from
// the seed rather than the chain, so it is available before any sync — and a
// wallet that has never synced needs its address first in order to be funded.
const NO_SYNC = process.argv.includes('--no-sync');

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   Wallet Balance Checker                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  try {
    console.log('  Building wallet...');
    const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
    const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
    if (restoredCount > 0) {
      console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
    }

    if (NO_SYNC) {
      console.log('');
      console.log(`  Address: ${walletCtx.unshieldedKeystore.getBech32Address()}`);
      console.log(`  Network: ${networkConfig.networkId}`);
      const pending = getDeployment(network);
      if (pending) {
        console.log(`  Contract: ${pending.address}`);
        console.log(`  Deployed: ${pending.deployedAt}`);
      }
      if (networkConfig.faucet) {
        console.log(`  Faucet:  ${networkConfig.faucet}`);
      }
      console.log('');
      console.log('  Skipped the network sync (--no-sync). Fund the address above, then');
      console.log('  run again without --no-sync to check the balance.');
      console.log('');
      await walletCtx.wallet.stop();
      return;
    }

    console.log('  Syncing with network...');
    console.log('  ℹ  This may take several minutes depending on network size.');
    console.log('     RPC disconnection messages during sync are normal and can be safely ignored.\n');
    const syncStart = Date.now();
    const syncInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - syncStart) / 1000);
      process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
    }, 5000);
    const state = await walletCtx.wallet.waitForSyncedState();
    clearInterval(syncInterval);
    process.stdout.write('\r  ✓ Synced with network.                                      \n');

    const address = walletCtx.unshieldedKeystore.getBech32Address();
    const tNightBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    const dustBalance = state.dust.balance(new Date());

    console.log('\n─── Wallet Details ─────────────────────────────────────────────\n');
    console.log(`  Address: ${address}`);
    console.log(`  Network: ${networkConfig.networkId}\n`);

    // What this network's wallet has deployed, read from the recorded state —
    // saves a trip to the README to answer "is anything deployed here?".
    const deployment = getDeployment(network);
    if (deployment) {
      console.log(`  Contract: ${deployment.address}`);
      console.log(`  Deployed: ${deployment.deployedAt}\n`);
    }

    console.log('─── Balances ───────────────────────────────────────────────────\n');
    console.log(`  tNight: ${tNightBalance.toLocaleString()}`);
    console.log(`  DUST:   ${dustBalance.toLocaleString()}\n`);

    if (tNightBalance === 0n) {
      if (network === 'undeployed') {
        console.log('  ⚠ Wallet has no tNight. Make sure the local devnet is running');
        console.log('     (npm run setup) — the genesis seed is pre-funded by the dev preset.\n');
      } else if (networkConfig.faucet) {
        console.log(`  ⚠ Wallet has no tNight. Fund it from the faucet:`);
        console.log(`     ${networkConfig.faucet}`);
        console.log(`     Wallet address: ${address}\n`);
      } else {
        console.log('  ⚠ Wallet has no tNight.\n');
      }
    } else {
      console.log('  ✅ Wallet is funded and ready!\n');
    }

    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
