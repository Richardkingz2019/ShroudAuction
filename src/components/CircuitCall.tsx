/**
 * CircuitCall — buttons that call the auction's circuits, the loading state
 * shown while a proof is generated, and the on-chain result afterwards.
 *
 * The bid amount is the one private input. It is typed into a masked field,
 * passed straight to `onSealBid`, and cleared. It is never rendered back, never
 * logged, and never placed in a transaction field — only its hash is.
 */

import { useState } from 'react';

import type { AuctionSnapshot, CircuitName, CircuitResult } from '../hooks/useMidnight';

interface CircuitCallProps {
  connected: boolean;
  pendingCircuit: CircuitName | null;
  auction: AuctionSnapshot | null;
  history: CircuitResult[];
  onSealBid: (amount: bigint) => Promise<CircuitResult | null>;
  onRevealBid: () => Promise<CircuitResult | null>;
  onCloseBidding: () => Promise<CircuitResult | null>;
  onSettle: () => Promise<CircuitResult | null>;
}

/** What each circuit is doing while it runs — shown under the spinner. */
const PENDING_TEXT: Record<CircuitName, string> = {
  submitSealedBid: 'Generating your zero-knowledge proof and sealing the bid…',
  revealBid: 'Proving your bid opens the commitment — the amount stays hidden unless you lead…',
  closeBidding: 'Closing bidding…',
  settle: 'Settling the auction…',
};

export function CircuitCall({
  connected,
  pendingCircuit,
  auction,
  history,
  onSealBid,
  onRevealBid,
  onCloseBidding,
  onSettle,
}: CircuitCallProps) {
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const busy = pendingCircuit !== null;
  const phase = auction?.phase ?? null;
  const canSeal = connected && !busy && (phase === null || phase === 0);
  const canReveal = connected && !busy && phase === 1;
  const canClose = connected && !busy && phase === 0;
  const canSettle = connected && !busy && phase === 1;

  const last = history[0] ?? null;

  async function handleSeal(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    let parsed: bigint;
    try {
      parsed = BigInt(amount.trim());
    } catch {
      setFormError('Enter a whole number.');
      return;
    }
    if (parsed <= 0n) {
      setFormError('The bid must be greater than zero.');
      return;
    }

    // Hand the amount over and immediately forget it locally. Only the public
    // commitment and tx id come back.
    setAmount('');
    await onSealBid(parsed);
  }

  return (
    <section className="card">
      <header className="card-head">
        <h2>Call a circuit</h2>
        <span className="pill pill-privacy" title="Zero-knowledge proof, generated locally">
          Proved without revealing your input
        </span>
      </header>

      {!connected ? (
        <p className="muted">Connect your wallet to call the auction circuits.</p>
      ) : null}

      {/* ── The private input ──────────────────────────────────────────── */}
      <form className="bid-form" onSubmit={handleSeal}>
        <label htmlFor="bid-amount">Your sealed bid amount (private)</label>
        <div className="bid-row">
          <input
            id="bid-amount"
            name="bid-amount"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 4200"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={!canSeal}
          />
          <button type="submit" className="btn btn-primary" disabled={!canSeal}>
            Seal bid
          </button>
        </div>
        <p className="hint">
          The amount is masked here, hashed together with a random nonce, and never leaves your
          machine. Only the 32-byte commitment is published.
        </p>
        {formError ? <p className="alert">{formError}</p> : null}
      </form>

      <div className="actions actions-wrap">
        <button type="button" className="btn" onClick={onRevealBid} disabled={!canReveal}>
          Prove &amp; reveal my bid
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCloseBidding} disabled={!canClose}>
          Close bidding (auctioneer)
        </button>
        <button type="button" className="btn btn-ghost" onClick={onSettle} disabled={!canSettle}>
          Settle auction (auctioneer)
        </button>
      </div>

      {/* Phase guidance, so the buttons are never mysterious. */}
      {connected && phase !== null ? (
        <p className="hint">
          {phase === 0 && 'Phase: Bidding — seal your bid. Reveal unlocks once bidding closes.'}
          {phase === 1 && 'Phase: Revealing — open your bid. Losing amounts stay private.'}
          {phase === 2 && 'Phase: Settled — the auction is over. The winner is on-chain.'}
        </p>
      ) : null}

      {/* ── Proof-generation loading state ─────────────────────────────── */}
      {pendingCircuit ? (
        <div className="pending" role="status" aria-live="assertive">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>Generating proof…</strong>
            <p className="muted">{PENDING_TEXT[pendingCircuit]}</p>
          </div>
        </div>
      ) : null}

      {/* ── Result after submission ────────────────────────────────────── */}
      {last ? (
        <div className="result">
          <h3>Last transaction</h3>
          <dl className="facts">
            <div>
              <dt>Circuit</dt>
              <dd>{last.circuit}</dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd className="ok">{last.label}</dd>
            </div>
            <div>
              <dt>Transaction id</dt>
              <dd>
                <code title={last.txId}>{last.txId}</code>
              </dd>
            </div>
            {last.blockHeight !== undefined ? (
              <div>
                <dt>Block height</dt>
                <dd>{last.blockHeight}</dd>
              </div>
            ) : null}
            {last.detail ? (
              <div>
                <dt>Published on-chain</dt>
                <dd>
                  <code className="tiny" title={last.detail}>
                    {last.detail}
                  </code>
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="hint">
            Nothing above is your bid amount — it is the public commitment and transaction data.
          </p>
        </div>
      ) : null}
    </section>
  );
}
