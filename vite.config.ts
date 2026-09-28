import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// The Midnight.js / compact-runtime packages are written for a modern runtime and
// occasionally reference Node built-ins. Target ES2022 and polyfill the handful
// of modules the SDK actually touches so the browser bundle resolves them the
// same way the Node scripts do.
export default defineConfig({
  plugins: [
    // `browser-level` (used for the private-state store) extends Node's
    // EventEmitter, and the indexer path reaches @subsquid's `assert`. Polyfill
    // only those built-ins rather than the whole node surface.
    nodePolyfills({
      include: ['events', 'assert', 'buffer', 'process', 'util'],
      globals: { Buffer: true, process: true, global: true },
      protocolImports: false,
    }),
    // The Midnight ledger ships a Rust/WASM core; the wallet's proving provider
    // and the ledger transaction types both depend on it.
    wasm(),
    react(),
  ],
  resolve: {
    alias: {
      // The indexer provider reads `ws.WebSocket`, but the browser build of
      // isomorphic-ws only has a default export. See src/shims/isomorphic-ws.ts.
      'isomorphic-ws': fileURLToPath(new URL('./src/shims/isomorphic-ws.ts', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The compiled contract and the ledger/runtime WASM glue make a large chunk;
    // it is expected, so lift the warning threshold rather than chase the size.
    chunkSizeWarningLimit: 6000,
  },
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
    // Pre-bundle the Midnight.js packages so dev-server cold starts are quick and
    // the CommonJS/ESM interop is resolved once.
    include: [
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/midnight-js-contracts',
      '@midnight-ntwrk/midnight-js-protocol',
    ],
  },
});
