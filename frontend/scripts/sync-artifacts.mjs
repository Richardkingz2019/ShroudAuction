/**
 * Copy the Compact compiler output into the frontend.
 *
 * Two destinations, because the browser needs the artifacts in two different ways:
 *
 *   public/contracts/auction/keys      fetched at runtime by FetchZkConfigProvider
 *   public/contracts/auction/zkir      (the wallet's proving provider reads these)
 *   public/contracts/auction/compiler  contract-info.json (runtime-version pin)
 *   src/generated/auction-contract     contract/index.js, imported and bundled by
 *                                      Vite so its `@midnight-ntwrk/compact-runtime`
 *                                      import resolves instead of being a bare
 *                                      specifier the browser cannot load
 *
 * Run `npm run compile` in the repo root first — contracts/managed/ is generated
 * and gitignored. This script is idempotent: it wipes and re-copies each target.
 */

import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '..');
const repoDir = path.resolve(frontendDir, '..');
const compiledDir = path.join(repoDir, 'contracts', 'managed', 'auction');

const publicOut = path.join(frontendDir, 'public', 'contracts', 'auction');
const contractOut = path.join(frontendDir, 'src', 'generated', 'auction-contract');

if (!existsSync(compiledDir)) {
  // The compiled output is generated and gitignored, so a checkout that only has
  // `frontend/` (which is what a Vercel build uploads) has no repo root to copy
  // from. The synced artifacts are committed on purpose, so fall back to them
  // rather than failing the build — but only if they are actually present.
  const haveCommitted =
    existsSync(path.join(publicOut, 'zkir')) &&
    existsSync(path.join(contractOut, 'index.js'));
  if (haveCommitted) {
    console.log(
      `\u2713 No compiler output at ${compiledDir}; using the committed artifacts ` +
        'in public/contracts/auction and src/generated/auction-contract.',
    );
    process.exit(0);
  }
  console.error(
    `\n\u2716 No compiled contract at ${compiledDir}\n` +
      '  Run `npm run compile` in the repository root first, then re-run this.\n',
  );
  process.exit(1);
}

async function reset(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

/** Copy a compiler subdirectory, keeping only files that match a predicate. */
async function copyFiltered(fromDir, toDir, keep) {
  if (!existsSync(fromDir)) return 0;
  await mkdir(toDir, { recursive: true });
  let copied = 0;
  for (const entry of await readdir(fromDir, { withFileTypes: true })) {
    if (!entry.isFile() || !keep(entry.name)) continue;
    await cp(path.join(fromDir, entry.name), path.join(toDir, entry.name));
    copied += 1;
  }
  return copied;
}

await reset(publicOut);
await reset(contractOut);

// ZK artifacts live under two names: `.bzkir` is what FetchZkConfigProvider 4.1.x
// requests; `.zkir` is kept alongside it so older tooling still works.
const zkirCount = await copyFiltered(
  path.join(compiledDir, 'zkir'),
  path.join(publicOut, 'zkir'),
  (name) => /\.(b?zkir)$/.test(name),
);

const keyCount = await copyFiltered(
  path.join(compiledDir, 'keys'),
  path.join(publicOut, 'keys'),
  (name) => /\.(prover|verifier)$/.test(name),
);

const runtimeInfoCount = await copyFiltered(
  path.join(compiledDir, 'compiler'),
  path.join(publicOut, 'compiler'),
  (name) => name === 'contract-info.json',
);

// The contract module is bundled, not served: it imports compact-runtime.
const moduleCount = await copyFiltered(
  path.join(compiledDir, 'contract'),
  contractOut,
  (name) => name === 'index.js' || name === 'index.d.ts',
);

console.log(
  `\u2713 Synced auction artifacts: ${keyCount} key files, ${zkirCount} zkir files, ` +
    `${runtimeInfoCount} compiler file, ${moduleCount} contract module files.`,
);
