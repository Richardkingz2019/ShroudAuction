/**
 * Fill the README "Contract Address" table from .midnight-state.json.
 *
 * `deploy.ts` already records every successful deploy via recordDeployment(),
 * so the address only ever lives in one place. Re-typing it into the README by
 * hand is the step people get wrong (truncated paste, wrong network row), and
 * it silently rots once a redeploy changes the address. Deriving the table from
 * the recorded state instead means the README cannot disagree with it.
 *
 * Idempotent: a network with no recorded deployment keeps its placeholder.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { STATE_FILE_NAME, getDeployment, NETWORK_IDS, type NetworkId } from '../src/network';

const README_PATH = 'README.md';

// 'undeployed' is the local devnet: it has no row in the README table.
const README_NETWORKS: NetworkId[] = NETWORK_IDS.filter((n) => n !== 'undeployed');

if (!existsSync(README_PATH)) {
  console.error(`No ${README_PATH} in ${process.cwd()} — run this from the project root.`);
  process.exit(1);
}

const readme = readFileSync(README_PATH, 'utf8');
let updated = readme;
let changed = 0;
const missing: NetworkId[] = [];

for (const network of README_NETWORKS) {
  const record = getDeployment(network);
  if (!record?.address) {
    missing.push(network);
    continue;
  }

  // Match the whole table row for this network and swap in the address, leaving
  // the surrounding table markup and every other row untouched.
  const label = network[0].toUpperCase() + network.slice(1);
  const rowRe = new RegExp(`^(\\|\\s*${label}\\s*\\|)(.*?)(\\|)\\s*$`, 'm');
  const next = updated.replace(rowRe, (match, open: string, cell: string, close: string) => {
    if (cell.trim() === record.address) return match;
    return `${open} ${record.address} ${close}`;
  });

  if (next === updated) {
    console.log(`  ${label}: README already shows ${record.address}`);
  } else {
    updated = next;
    changed += 1;
    console.log(`  ${label}: wrote ${record.address} into ${README_PATH}`);
  }
}

if (changed > 0) writeFileSync(README_PATH, updated);

for (const network of missing) {
  const label = network[0].toUpperCase() + network.slice(1);
  console.log(`  ${label}: not deployed yet — placeholder left in place`);
}

console.log('');
if (changed === 0 && missing.length === README_NETWORKS.length) {
  console.log(`No deployments found in ${STATE_FILE_NAME}. Deploy first, then re-run.`);
} else {
  console.log(`Done. ${changed} row(s) updated in ${README_PATH}.`);
}
