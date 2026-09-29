# Product Proposal

## What is the product, and who uses it?

**ShroudAuction** is a sealed-bid auction on Midnight where bids stay secret while bidding is open and losing bid amounts are never revealed — not even to the auctioneer. A bidder publishes only a 32-byte commitment; the reveal happens inside a zero-knowledge proof, so a losing bid is verified and then discarded with its amount never written to the ledger.

**Who uses it:**

- **Bidders** — anyone who wants to bid on-chain without broadcasting their price (or linking the bid to their wallet, thanks to pseudonyms) until it wins.
- **Auctioneers** — sellers running procurement, treasury swaps, NFT sales or token auctions who need credible *sealed* bidding without becoming a trusted party who sees every number.
- **Builders** — an open-source reference for commitment + in-circuit-compare patterns on Midnight (Compact circuit, Midnight.js dApp, offline test suite).

**Live dApp:** <https://frontend-liart-nine-0xq4nwn1c5.vercel.app> (Lace wallet on Preprod) · **Repo:** <https://github.com/Richardkingz2019/ShroudAuction>

## Why Midnight specifically?

A transparent chain (Ethereum-style) cannot hide a `uint256` bid: every storage write is public, so a commit–reveal scheme leaks every *losing* amount at reveal time. Moving the bids "off-chain behind an operator" rebuilds the trusted auctioneer the chain was supposed to remove.

Midnight is the first chain where the default is what an auction actually needs:

- **Private witnesses by construction** — `bidAmount()`, `bidNonce()` and `bidderAlias()` live only in the bidder's private state; they are never part of a transaction.
- **Explicit disclosure** — the Compact compiler refuses a ledger operation that could leak a witness unless it is wrapped in `disclose()`. This contract has exactly three, each deliberate: the pseudonym, a one-bit "took the lead" result, and the amount of a bid that wins.
- **Verification without exposure** — the contract recomputes the commitment and compares the opened amount against the running high bid *in-circuit*; a losing bid's amount never reaches the ledger.
- **Wallet-side proving** — proofs are generated locally by the Lace wallet's proving provider in the browser, so private inputs never leave the bidder's machine.

The nonce is load-bearing, not decoration: the amount is a `Uint<64>`, so without 32 bytes of blinding the published commitment could be brute-forced by anyone who can guess the range.

## Data Model

| Data Point            | Type              | Disclosed To                                    |
|-----------------------|-------------------|-------------------------------------------------|
| `phase`               | Public ledger     | Everyone — `Bidding` / `Revealing` / `Settled`  |
| `auctioneer`          | Public ledger     | Everyone — coin public key that created the auction |
| `bidCount`            | Public ledger     | Everyone — how many sealed bids were accepted   |
| `sealedBids`          | Public ledger     | Everyone — pseudonym → 32-byte commitment (who bid, never what) |
| `revealedCount`       | Public ledger     | Everyone — how many bids have been opened       |
| `highestBid`          | Public ledger     | Everyone — written only when a bid takes the lead |
| `highestBidder`       | Public ledger     | Everyone — the winner's pseudonym               |
| `bidAmount()`         | Private witness   | No one — `Uint<64>`, never written on-chain unless it wins |
| `bidNonce()`          | Private witness   | No one — 32 random bytes blinding the commitment |
| `bidderAlias()`       | Private witness   | No one (the pseudonym itself is disclosed, its link to the wallet is not) |
| Tx id / commitment    | Public            | Everyone — the only thing a sealed bid publishes |

## Mainnet Feasibility

**Realistic for Level 6.** The path is short because everything hard is already proven off-mainnet:

- The Compact circuit (toolchain 0.31.1) compiles, and 20 offline tests cover circuit logic, state transitions and privacy assertions over the decoded ledger.
- The dApp is deployed on **Preprod** today with wallet-generated proofs — the same architecture Mainnet uses; deployment is a static Vercel bundle pointing at a Mainnet contract address.
- Deployment scripts (`npm run deploy`) already parameterize the network, register NIGHT for DUST, and rewrite the address into the README; Mainnet only adds a funded wallet and the faucet/faucet-equivalent step.
- Remaining gaps are operational, not technical: a funded Mainnet wallet, a Mainnet-indexed `VITE_CONTRACT_ADDRESS`, and re-running the same verify/settle flow. No circuit or contract redesign is required.
