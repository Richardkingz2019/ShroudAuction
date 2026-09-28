/**
 * The ShroudAuction client.
 *
 * Layout is: hero → wallet → public state → circuit calls → history. The one
 * screen demonstrates the whole privacy claim: connect, seal a bid without
 * revealing it, and watch the public ledger hold a hash and nothing else.
 */

import { AuctionState } from './components/AuctionState';
import { CircuitCall } from './components/CircuitCall';
import { WalletConnect } from './components/WalletConnect';
import { useMidnight } from './hooks/useMidnight';

export function App() {
  const midnight = useMidnight();

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Midnight · sealed-bid auction</p>
        <h1>ShroudAuction</h1>
        <p className="lede">
          Bid on-chain without revealing your bid. Every bid is sealed behind a commitment and
          opened inside a zero-knowledge proof — a bid that does not win is never written down.
        </p>
        <p className="lede small">
          A sealed bid publishes a <strong>32-byte hash</strong>. An on-chain observer sees{' '}
          <em>who</em> bid (behind a pseudonym) and <em>that</em> they bid — never <em>what</em>{' '}
          they offered.
        </p>
      </header>

      <main className="grid">
        <WalletConnect
          status={midnight.status}
          walletName={midnight.walletName}
          walletAddress={midnight.walletAddress}
          networkId={midnight.networkId}
          contractAddress={midnight.contractAddress}
          error={midnight.error}
          onConnect={midnight.connect}
          onDisconnect={midnight.disconnect}
        />

        <AuctionState
          connected={midnight.status === 'connected'}
          auction={midnight.auction}
          auctionError={midnight.auctionError}
          onRefresh={midnight.refresh}
        />

        <CircuitCall
          connected={midnight.status === 'connected'}
          pendingCircuit={midnight.pendingCircuit}
          auction={midnight.auction}
          history={midnight.history}
          onSealBid={midnight.sealBid}
          onRevealBid={midnight.revealBid}
          onCloseBidding={midnight.closeBidding}
          onSettle={midnight.settle}
        />
      </main>

      <footer className="foot">
        <p>
          Built on the Midnight network with Compact and the Midnight.js SDK. Proofs are generated
          locally by the wallet's proving provider.
        </p>
      </footer>
    </div>
  );
}

export default App;
