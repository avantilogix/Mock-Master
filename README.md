# Mission Selection

Mission Selection is a B2C preparation app for mock tests and e-books. The responsive web app also runs on Android as an installed web app. One Node.js service serves both the UI and API; SQLite stores accounts, payment requests, and course content on a persistent disk. Firebase Authentication handles Indian mobile OTP. Students pay through UPI, submit a transaction reference, and an administrator approves the request before access is unlocked. Email is not collected, so Mailtrap is not required.

## Run locally

Install Node.js 22 (22.13 or newer), Poppler (`poppler-utils` on Debian/Ubuntu), `unzip`, and a sans-serif font such as DejaVu Sans. Install `zip` to run the DOCX fixture test.

```sh
npm ci
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. Browsing works without provider credentials; login and payment submission require the configuration below. `npm test` runs the Node integration tests; document tests skip when their OS tools are unavailable.

### Firebase phone sign-in

1. Register a Web App in a Firebase project and enable **Phone** in Authentication. Configure the SMS region policy for India and add the actual web hostname to Firebase's authorized domains. Use a configured development HTTPS hostname and Firebase's fictional phone numbers to test without sending SMS.
2. Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, and `FIREBASE_AUTH_DOMAIN` from the web app configuration. These are client configuration values; do not use a service account key.
3. Sign in with each authorized admin's verified Indian mobile number. Copy the user's Firebase **UID** into the comma-separated `ADMIN_UIDS` list and restart. Administrators can publish courses, tests, and books and view support messages. Do not assign admin access by entering a phone number into `ADMIN_UIDS`.

### UPI payments and admin approval

Set `UPI_ID` and `UPI_PAYEE_NAME` to the receiving UPI account. The server creates the amount-specific QR locally; no payment page or third-party QR service is used. Students see the configured UPI details, pay in their own UPI application, and submit its transaction reference. Administrators use the same mobile sign-in, enter their Firebase UID in `ADMIN_UIDS`, and see the **Payment approvals** section.

An admin must independently verify the amount, reference, and receiving account before approving. Approval alone unlocks the purchased course. Rejected requests include a reason and can be corrected and resubmitted by the student. Refunds, chargebacks, and entitlement revocation still require an operator process; do not enable live sales without one.

### Publish courses and import tests

Create a course with a price, then add mock tests and e-books from the admin portal. Course cards and reviews are public; test questions, reading pages, and the course discussion group are restricted to purchasers and administrators. Each course has its own discussion group. Students can save a display name, submit a course review after purchase, and send support requests.

Enter questions manually or import a **text-based PDF**, UTF-8 text file, or `.docx` in this format:

```text
1. What is 2 + 2?
A. 3
B. 4
Answer: B

2. Which is a prime number?
A. 8
B. 11
Answer: B
```

Use one numbered question and one option per line, followed by its `Answer:` line. After import, review the extracted questions before publishing. Scanned PDFs, legacy `.doc`, multicolumn layouts, and documents with separate answer keys need conversion or reformatting first. The reader serves page images with the signed-in student's phone number baked into the image; it does not send the original PDF to the client. The watermark discourages redistribution but cannot prevent screenshots. Disclose it to students before offering paid content.

## Deploy and install on Android

Run one service instance behind an HTTPS reverse proxy on a host with a persistent volume. Set `DATA_DIR` to a private, backed-up directory; use a SQLite-aware backup while the service is running. Install the same OS document tools as above, supply environment variables through the host's secret store, and run under a dedicated unprivileged user. Configure the proxy to accept the application's 12 MiB binary-upload limit. If a local reverse proxy is the only caller and overwrites `X-Forwarded-For`, set `TRUST_LOCAL_PROXY=true` to apply rate limits per client. Do not expose the database directory or run multiple replicas with independent disks. Review provider quotas, monitoring, privacy disclosures, and support operations before going live.

- **Android browser:** Open the deployed HTTPS origin in Chrome and use **Install app** or **Add to Home screen**. The app requires connectivity for sign-in, purchases, and course content.
- **Android APK/AAB:** `android/package.sh` documents how to generate a Trusted Web Activity with Bubblewrap from the deployed web manifest, build it, and verify association using `android/assetlinks.example.json`. Copy the configured file to `public/.well-known/assetlinks.json` and restart the service. A signed Android package requires your origin, package ID, and signing key.
- **Google Play:** This version uses UPI payment requests outside an integrated gateway. Before distributing an APK/AAB through Google Play, review the applicable digital-goods billing policy; this project does **not** implement Play Billing or an enrolled alternative-billing flow.