# Mission Selection

Mission Selection is a B2C preparation app for mock tests and e-books. The responsive web app also runs on Android as an installed web app. One Node.js service serves both the UI and API; SQLite stores accounts, payment requests, and course content on a persistent disk. Firebase Authentication handles Indian mobile OTP. Students pay through UPI, submit a transaction reference, and an administrator approves the request before access is unlocked. Email is not collected, so Mailtrap is not required.

## Run locally

Install Node.js 22 (22.13 or newer), `unzip`, and a sans-serif font such as DejaVu Sans. Install `zip` to run the DOCX fixture test. PDF page counting and secure page rendering use bundled Node libraries and do not require Poppler. The optional Poppler `pdftotext` command is still used for importing questions from PDFs.

```sh
npm ci
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. Browsing works without provider credentials; login and payment submission require the configuration below. `npm test` runs the Node integration tests; document tests skip when their OS tools are unavailable.

Run `npm run seed` to add or refresh three sample preparation missions, each with a practice test and protected starter e-book. The seed is idempotent and does not create users, purchases, fake reviews, or admin permissions.

The Phase 2 and Phase 3 student experience includes persisted test reports, notifications, current affairs, PYQs, syllabus resources, a student timetable, referral codes, protected page downloads, and physical-book UPI/shipping orders. Admins can publish timetable entries and learning resources, manage physical-book inventory and fulfillment, configure social links, and disable or reactivate student accounts from the Admin workspace. Physical-book stock is reduced only when the admin approves the payment; course access remains separate.

Current Affairs resources are grouped by publication year and month. Set the publish date in the Admin learning-resource form when adding an update. Payment checkout is also admin-configurable: save a UPI ID/payee, upload a PNG/JPEG/WebP QR image, then enable UPI, QR, or both. Admin approval of the submitted transaction reference remains mandatory before digital-course access is unlocked.

In **Admin → Upload a Study Book or Video**, select a course, subject and chapter (or add new names). Upload a PDF or an MP4, WebM or MOV video up to 300 MB. The form keeps the selected chapter after publishing so you can add both file types there. Students open materials by course, subject and chapter, or use the **PDF** and **Video** tabs under Downloads. Original PDFs stay private; PDF downloads are individual watermarked PNG pages. **Manage Published Content** shows publication dates and provides edit and delete controls. Courses with purchase records and tests with student results cannot be deleted from the live admin dashboard.

Referral credits are shown as rupee credits at checkout. Students can apply any available balance to a course; partial use reduces the amount that must be paid by UPI/QR, while a fully covered purchase unlocks after the credits are reserved. Admin rejection restores reserved credits. Syllabus has its own student destination and no longer shares the Previous Year Questions route.

### Firebase phone sign-in

1. Register a Web App in a Firebase project and enable **Phone** in Authentication. Configure the SMS region policy for India and add the actual web hostname to Firebase's authorized domains. Use a configured development HTTPS hostname and Firebase's fictional phone numbers to test without sending SMS.
2. Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, and `FIREBASE_AUTH_DOMAIN` from the web app configuration. These are client configuration values; do not use a service account key.
3. Sign in with each authorized admin's verified Indian mobile number. Copy the user's Firebase **UID** into the comma-separated `ADMIN_UIDS` list and restart. Administrators can publish courses, tests, and books and view support messages. Do not assign admin access by entering a phone number into `ADMIN_UIDS`.

If the browser reports `accounts:sendVerificationCode` with HTTP 400, inspect the JSON response in DevTools and the visible Mission Selection error:

- Enable **Authentication → Sign-in method → Phone**.
- Add `127.0.0.1`, `localhost`, and every deployed hostname under **Authentication → Settings → Authorized domains**.
- Under **Authentication → Settings → SMS region policy**, allow India for the target environment.
- Keep the Firebase web API key unrestricted by Google Cloud referrer rules, or explicitly allow the deployed HTTPS origin and localhost addresses.
- Real-number SMS requires the applicable Firebase Phone Auth quota/billing. Test with a configured fictional number during development.
- A console warning about falling back from reCAPTCHA Enterprise to reCAPTCHA v2 is not itself the failure.

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

On the Firebase site, new courses require an expiry date. The selected day is included through 11:59 p.m. India time; at the next midnight, purchases and student access to course materials close. Existing courses without a date are unchanged until an admin sets one in **Manage Published Content**. New courses, PDF study books, and physical books require 1–8 distinct JPEG, PNG, or WebP covers (up to 6 MB each). Covers are resized for the web and are public; do not use private information or protected book pages as covers. Multiple covers appear in a swipeable gallery.

On Firebase Hosting, deploy the Hosting site and its pinned API function together. Chapter video uploads go directly to the private Cloud Storage bucket using signed PUT URLs, rather than passing large request bodies through Hosting or Functions. Apply [firebase-media-cors.json](./firebase-media-cors.json) to the media bucket (merge with any existing CORS rules first). The function runtime service account needs `iam.serviceAccounts.signBlob` on its own identity and object read, create and delete access to the private media bucket. Firebase Storage rules should continue to deny direct client access. Only the API issues time-limited URLs after checking admin or purchaser access.

Run one service instance behind an HTTPS reverse proxy on a host with a persistent volume. Set `DATA_DIR` to a private, backed-up directory; use a SQLite-aware backup while the service is running. Install the same OS document tools as above, supply environment variables through the host's secret store, and run under a dedicated unprivileged user. Configure the proxy to accept the application's 12 MiB binary-upload limit. If a local reverse proxy is the only caller and overwrites `X-Forwarded-For`, set `TRUST_LOCAL_PROXY=true` to apply rate limits per client. Do not expose the database directory or run multiple replicas with independent disks. Review provider quotas, monitoring, privacy disclosures, and support operations before going live.

- **Android browser:** Open the deployed HTTPS origin in Chrome and use **Install app** or **Add to Home screen**. The app requires connectivity for sign-in, purchases, and course content.
- **Android UI:** The installed app is a Trusted Web Activity, so it renders the same routes and components as the hosted site. The Material-inspired tokens, responsive layouts, and component treatments are in [`public/assets/android-design.css`](./public/assets/android-design.css). Validate the same screens in Chrome at narrow widths and in the installed app; the latter also checks system bars, the soft keyboard, and Digital Asset Links.
- **Android APK/AAB:** `android/package.sh` documents how to generate a Trusted Web Activity with Bubblewrap from the deployed web manifest, build it, and verify association using `android/assetlinks.example.json`. Copy the configured file to `public/.well-known/assetlinks.json` and restart the service. A signed Android package requires your origin, package ID, and signing key.
- **Google Play:** This version uses UPI payment requests outside an integrated gateway. Before distributing an APK/AAB through Google Play, review the applicable digital-goods billing policy; this project does **not** implement Play Billing or an enrolled alternative-billing flow.