# Self-hosted edition

The same app, run by a customer on their own infrastructure, unlocked by a
signed license file instead of a hosted account. Licenses are checked locally
with `offline-license` — the install never phones home.

## Issue a license (you, once per customer)

```ts
import { generateKeyPair, issue, bindMachine } from "offline-license";

const { privateKey, publicKey } = generateKeyPair();   // keep privateKey on your side only
const token = issue(privateKey, {
  id: "lic_acme_2026",
  licensee: "Acme Ltd",
  features: ["admin"],                                   // "admin" unlocks /admin on the install
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 365 * 86_400,
  // optional: machine: bindMachine("lic_acme_2026", customerFingerprint),
});
```

Send the customer `token` and `publicKey`.

## Install it (the customer)

```
LICENSE_TOKEN="lic1...."
LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

`src/server/license.ts` reads both. The admin page shows the edition and the
licensee; `/api/admin/*` refuses with 403 when the license is missing the
`admin` feature, expired, or bound to another machine. Without either variable
the app runs as the cloud edition and admin is governed by roles alone.
