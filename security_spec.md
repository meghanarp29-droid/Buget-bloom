# BudgetBloom Security Specification

This security specification implements an Attribute-Based Access Control (ABAC) plan and maps key data validation rules to secure Firebase Firestore documents against malicious reads/writes.

## 1. Data Invariants
- Each user profile in `/users/{userId}` can only be read, created, or updated by the user whose Firestore Authentication `uid` matches the `userId` folder path.
- All transactions, budgets, wallets, and savings goal items must contain a valid `userId` field matching the authenticated user's `uid`.
- Data cannot be read, updated, or deleted by unauthenticated requests or other authenticated users.
- Numeric boundaries: All budget settings, savings targets, and transaction amounts must have positive numerical guards (e.g. amount > 0 for transactions) to prevent integer overflows or resource depletion attacks.

## 2. The "Dirty Dozen" Spoofing Payloads
Below are 12 malicious payloads designed to violate system safety limits. In all cases, the FireStore rule gates will reject these payloads.

| # | Attempt Type | Collection / Path | Malicious Payload | Rejected By |
|---|--------------|-------------------|-------------------|-------------|
| 1 | Profile Theft | `users/victim_123` | `{ "uid": "attacker_456", "email": "evil@attacker.com" }` | `isOwner(userId)` verification |
| 2 | Write Injection | `transactions/t1` | `{ "userId": "victim_123", "amount": 200, "category": "Food" }` | `userId == request.auth.uid` rule |
| 3 | Overspend Credit | `transactions/t2` | `{ "userId": "attacker_456", "amount": -999999, "type": "expense" }` | `amount > 0` constraint |
| 4 | Denial of Wallet | `transactions/t3` | `{ "userId": "attacker_456", "amount": 100, "description": "A" * 10000 }` | `description.size() <= 200` gate |
| 5 | Budget Manipulation | `budgets/b1` | `{ "userId": "victim_123", "category": "Rent", "limit": 500 }` | `resource.data.userId == request.auth.uid` |
| 6 | Ghost Field Insertion | `budgets/b2` | `{ "userId": "attacker_456", "limit": 1000, "ghost_admin": true }` | Strict schema validation helper |
| 7 | Account balance hack | `wallets/w1` | `{ "userId": "attacker_456", "name": "Cash", "balance": "infinity" }` | `balance is number` requirement |
| 8 | Large Payload Attack | `wallets/w2` | `{ "userId": "attacker_456", "name": "ExcessiveName" * 500, "type": "Cash" }` | `name.size() <= 100` restraint |
| 9 | Impersonated Goal Contribution | `goals/g1` | `{ "userId": "victim_123", "targetAmount": 1000 }` | `userId == request.auth.uid` validation |
| 10 | Negative Goal | `goals/g2` | `{ "userId": "attacker_456", "name": "Laptop", "targetAmount": -50 }` | `targetAmount > 0` validation |
| 11 | Spoofed Email Verify | `users/attacker` | `{ "email_verified": false }` but attempting to use admin scopes | Verification checks |
| 12 | Bulk Read Scraping | `transactions` | Attempting to do `get()` or `list` without filters | Rule-side check `resource.data.userId == request.auth.uid` |

## 3. The Test Runner Concept
The tests simulate rules enforcement:
- `firebase.initializeTestEnvironment()`
- Runs tests verifying `assertSucceeds` for local users and `assertFails` for crossed requests.
