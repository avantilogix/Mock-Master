# Mock Master

Mock Master is a B2C storefront for mock tests and e-books. The responsive web app also runs on Android as an installed web app. One Node.js service serves both the UI and API; SQLite stores accounts, orders, and course content on a persistent disk. Firebase Authentication handles Indian mobile OTP, and Razorpay Checkout handles INR payments. Email is not collected, so Mailtrap is not required.

## Run locally

Install Node.js 22 (22.13 or newer), Poppler (`poppler-utils` on Debian/Ubuntu), `unzip`, and a sans-serif font such as DejaVu Sans. Install `zip` to run the DOCX fixture test.

```sh
npm ci
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. Browsing works without provider credentials; login and checkout require the configuration below. `npm test` runs the Node integration tests; document tests skip when their OS tools are unavailable.

### Firebase phone sign-in

1. Register a Web App in a Firebase project and enable **Phone** in Authentication. Configure the SMS region policy for India and add the actual web hostname to Firebase's authorized domains. Use a configured development HTTPS hostname and Firebase's fictional phone numbers to test without sending SMS.
2. Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, and `FIREBASE_AUTH_DOMAIN` from the web app configuration. These are client configuration values; do not use a service account key.
3. Sign in with each authorized admin's verified Indian mobile number. Copy the user's Firebase **UID** into the comma-separated `ADMIN_UIDS` list and restart. Administrators can publish courses, tests, and books and view support messages. Do not assign admin access by entering a phone number into `ADMIN_UIDS`.

### Razorpay

Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` with test credentials first. Enable automatic capture and configure the `payment.captured` event at `https://YOUR_HOST/api/payments/webhook`; set `RAZORPAY_WEBHOOK_SECRET` to the webhook secret (distinct from the API secret). Use a test checkout and verify that the course unlocks after capture. The server sets the price from the catalog and matches payment currency, amount, and order before granting access. The browser callback and webhook can arrive in either order. If capture is delayed, students can return to the dashboard and refresh purchases.

Refunds, chargebacks, and entitlement revocation are not automated. Do not enable live sales until an operator process or integration for these cases is in place.

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

Run one service instance behind an HTTPS reverse proxy on a host with a persistent volume. Set `DATA_DIR` to a private, backed-up directory; use a SQLite-aware backup while the service is running. Install the same OS document tools as above, supply environment variables through the host's secret store, and run under a dedicated unprivileged user. Configure the proxy to accept the application's 12 MiB binary-upload limit. Do not expose the database directory or run multiple replicas with independent disks. Review provider quotas, monitoring, privacy disclosures, and support operations before going live.

- **Android browser:** Open the deployed HTTPS origin in Chrome and use **Install app** or **Add to Home screen**. The app requires connectivity for sign-in, purchases, and course content.
- **Android APK/AAB:** `android/package.sh` documents how to generate a Trusted Web Activity with Bubblewrap from the deployed web manifest, build it, and verify association using `android/assetlinks.example.json`. Serve the configured file at `public/.well-known/assetlinks.json` on the same origin. A signed Android package requires your origin, package ID, and signing key.
- **Google Play:** Razorpay is configured for direct web checkout. Before distributing an APK/AAB through Google Play, review the applicable digital-goods billing policy; this project does **not** implement Play Billing or an enrolled alternative-billing flow.