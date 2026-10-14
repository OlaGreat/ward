# Ward

**Hospital-verified medical fundraising on [Midnight](https://midnight.network).**
*Prove the bill is real. Keep the diagnosis private.*

> Status: in active development for the Midnight Buildathon. The Compact contract and its test suite are in place; the deploy tooling and web app are next.

## The problem

About 2.1 billion people face financial hardship paying for healthcare ([WHO and World Bank, 2025](https://www.who.int/news/item/06-12-2025-most-countries-make-progress-towards-universal-health-coverage-but-major-challenges-remain-who-world-bank-report-finds)), and medical needs make up roughly a third of the money raised on crowdfunding platforms. To be believed, families publish their names, diagnoses and hospital photos. Even then, donors cannot tell a real appeal from a fake one, because hospital documents are easy to forge and campaigns are rarely verified before they go live.

## How Ward works

1. **A hospital issues the bill.** A hospital registered on Ward records the bill on Midnight. Its name and the amount due are public; the patient's identity and diagnosis are never part of any transaction. The patient receives a private claim code.
2. **The patient opens the fundraiser.** Using the claim code, the patient proves in zero knowledge that they hold a real, hospital-issued bill, without revealing who they are. Each bill can have exactly one fundraiser.
3. **Donors give with confidence.** Every donation is forwarded by the contract straight to the hospital's payout address, so a copied appeal cannot redirect money. The fundraiser closes automatically once the bill is paid, and the hospital can confirm that treatment was completed.

## What is public and what stays private

| Public on the Midnight ledger | Private (only on the user's device) |
|---|---|
| Registered hospitals and their payout addresses | Hospital and operator secret keys |
| Each bill's hospital, amount due, amount raised and status | The patient's claim code |
| The fundraiser title the patient chooses to publish | The patient's identity, diagnosis and records |
| "Treatment completed" confirmations | |

The contract never sees medical data. Patients prove knowledge of their claim code inside the proof; only a hash commitment of it is stored on-chain, and the test suite checks that the code never appears in a transaction's public transcript.

## Repository layout

```
contract/
  src/ward.compact        Compact contract: hospital registry, bills, fundraisers, donations
  src/witnesses.ts        Private state and witness implementations
  src/test/               Contract simulator and Vitest test suite
```

## Build and test

Prerequisites:

- Node.js 24.11 or later
- The Compact toolchain, pinned to the version the Midnight networks run:

  ```bash
  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
  compact update 0.31.1
  ```

Then:

```bash
npm install
npm run compact     # compile the contract (generates keys and TypeScript bindings)
npm run typecheck
npm test            # run the contract test suite in the local simulator
```

## License

Apache License 2.0. See [LICENSE](LICENSE).

The build setup is adapted from Midnight's [example-bboard](https://github.com/midnightntwrk/example-bboard) template, also under Apache 2.0.
