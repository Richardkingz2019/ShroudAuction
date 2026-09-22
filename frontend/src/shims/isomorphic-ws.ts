/**
 * Shim for `isomorphic-ws` in the browser.
 *
 * The published `isomorphic-ws` browser entry only has a *default* export, but
 * `@midnight-ntwrk/midnight-js-indexer-public-data-provider` imports the
 * namespace and reads `ws.WebSocket`, which would be `undefined` in a browser
 * bundle. Vite aliases `isomorphic-ws` to this file so the named export points
 * at the global WebSocket the browser already provides.
 */

type WebSocketCtor = typeof globalThis.WebSocket;

const WebSocketImpl: WebSocketCtor | undefined = globalThis.WebSocket;

export { WebSocketImpl as WebSocket };
export default WebSocketImpl;
