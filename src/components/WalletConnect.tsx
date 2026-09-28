/**
 * WalletConnect — connect / disconnect, and the wallet facts the page needs.
 *
 * Four states are rendered explicitly: not connected, connecting, connected
 * (with the shielded address), and error (wallet missing, user rejected, or
 * network mismatch — the hook maps connector failures onto those messages).
 */

import type { ConnectionStatus } from '../hooks/useMidnight';

interface WalletConnectProps {
  status: ConnectionStatus;
  walletName: string | null;
  walletAddress: string | null;
  networkId: string;
  contractAddress: string;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

const short = (value: string, head = 12, tail = 8): string =>
  value.length <= head + tail ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;

export function WalletConnect({
  status,
  walletName,
  walletAddress,
  networkId,
  contractAddress,
  error,
  onConnect,
  onDisconnect,
}: WalletConnectProps) {
  const connected = status === 'connected';

  return (
    <section className="card wallet-card" aria-live="polite">
      <header className="card-head">
        <h2>Wallet</h2>
        <span className={`pill ${connected ? 'pill-ok' : 'pill-off'}`}>
          {connected ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Disconnected'}
        </span>
      </header>

      {connected && walletAddress ? (
        <dl className="facts">
          <div>
            <dt>Wallet address</dt>
            <dd>
              <code title={walletAddress}>{short(walletAddress)}</code>
            </dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{networkId}</dd>
          </div>
          <div>
            <dt>Contract</dt>
            <dd>
              <code title={contractAddress}>{short(contractAddress)}</code>
            </dd>
          </div>
          {walletName ? (
            <div>
              <dt>Detected wallet</dt>
              <dd>{walletName}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="muted">
          Connect the Lace wallet (Midnight-enabled, on <strong>{networkId}</strong>) to read
          the auction and call its circuits.
        </p>
      )}

      {error ? <p className="alert">{error}</p> : null}

      <div className="actions">
        {connected ? (
          <button type="button" className="btn btn-ghost" onClick={onDisconnect}>
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConnect}
            disabled={status === 'connecting'}
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect Lace wallet'}
          </button>
        )}
      </div>
    </section>
  );
}
