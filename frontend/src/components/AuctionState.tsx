/**
 * AuctionState — the auction exactly as the chain sees it.
 *
 * Everything here is a public ledger field. There is deliberately no bid-amount
 * list: losing amounts are never written on-chain, so there is nothing to show.
 */

import type { AuctionSnapshot } from '../hooks/useMidnight';

interface AuctionStateProps {
  connected: boolean;
  auction: AuctionSnapshot | null;
  auctionError: string | null;
  onRefresh: () => void;
}

export function AuctionState({ connected, auction, auctionError, onRefresh }: AuctionStateProps) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>Public auction state</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={!connected}>
          Refresh
        </button>
      </header>

      {!connected ? (
        <p className="muted">Connect a wallet to read the auction from the chain.</p>
      ) : auctionError ? (
        <p className="alert">{auctionError}</p>
      ) : !auction ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <dl className="facts">
            <div>
              <dt>Phase</dt>
              <dd>
                <span className="pill pill-phase">{auction.phaseLabel}</span>
              </dd>
            </div>
            <div>
              <dt>Sealed bids</dt>
              <dd>{auction.bidCount}</dd>
            </div>
            <div>
              <dt>Opened bids</dt>
              <dd>{auction.revealedCount}</dd>
            </div>
            <div>
              <dt>Still sealed</dt>
              <dd>{auction.unopened}</dd>
            </div>
            <div>
              <dt>Highest bid</dt>
              <dd>{auction.highestBid === 0n ? '(none yet)' : auction.highestBid.toString()}</dd>
            </div>
            <div>
              <dt>Leading pseudonym</dt>
              <dd>
                <code className="tiny" title={auction.highestBidder}>
                  {auction.highestBidder === '0'.repeat(64) ? '(none yet)' : auction.highestBidder}
                </code>
              </dd>
            </div>
            <div>
              <dt>Auctioneer key</dt>
              <dd>
                <code className="tiny" title={auction.auctioneer}>
                  {auction.auctioneer}
                </code>
              </dd>
            </div>
          </dl>
          <p className="hint">
            Losing bid amounts are absent from this list because they are never written to the
            ledger. The map on-chain stores a pseudonym and a 32-byte hash, not an amount.
          </p>
        </>
      )}
    </section>
  );
}
