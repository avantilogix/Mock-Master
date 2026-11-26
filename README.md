# Mission Selection

Mission Selection is a B2C preparation app for mock tests and e-books. The responsive web app also runs on Android as an installed web app. One Node.js service serves both the UI and API; SQLite stores accounts, payment requests, and course content on a persistent disk. Firebase Authentication verifies Indian mobile OTPs and manages linked username/password credentials. Completed sign-ins persist on the device until sign-out or session invalidation; email is not collected, so Mailtrap is not required.

## Run locally

Install Node.js 22 (22.13 or newer), `unzip`, and a sans-serif font such as DejaVu Sans. Install `zip` to run the DOCX fixture test. PDF page counting and secure page rendering use bundled Node libraries and do not require Poppler. The optional Poppler `pdftotext` command is still used for importing questions from PDFs.

```sh
npm ci
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. Sign-in and app access require the Firebase configuration below. `npm test` runs the Node integration tests; document tests skip when their OS tools are unavailable.

Local browser workflows use `npm run test:e2e`; to focus on the admin course Add/Edit flow, use `npm run test:e2e:admin-course`. Playwright runs the dummy app on `127.0.0.1:3011` with data under `data/playwright-admin-audit-tests`, separate from the local app on port 3010. The test runner reuses one browser worker and creates isolated contexts per test. For repeated focused runs, start the isolated server once in a PowerShell terminal and opt into reusing it in another:

The app requires an internet connection to sign in and access learning content. When the connection is unavailable, it shows a retry notice and checks for recovery automatically. A service worker caches only the offline screen, not course content or credentials; it must be installed during an earlier online visit for a browser to show that screen on an offline launch. The generated Android wrapper also includes the offline screen for a failed initial page load; existing installed wrappers need an updated build to receive that native change.

```powershell
$env:DATA_DIR = '.\data\playwright-admin-audit-tests'
$env:HOST = '127.0.0.1'
$env:PORT = '3011'
$env:UPI_ID = 'missionselection@upi'
$env:UPI_PAYEE_NAME = 'Mission Selection'
npm run seed
npm run start:dummy
```

```powershell
$env:PLAYWRIGHT_REUSE_SERVER = '1'
npm run test:e2e:admin-course
```

Run `npm run seed` to add or refresh three sample preparation missions, each with a practice test and protected starter e-book. The seed is idempotent and does not create users, purchases, fake reviews, or admin permissions.

The Phase 2 and Phase 3 student experience includes persisted test reports, notifications, current affairs, PYQs, syllabus resources, a student timetable, referral codes, protected page downloads, and physical-book UPI/shipping orders. Admins can publish timetable entries and learning resources, manage physical-book inventory and fulfillment, configure social links, and disable or reactivate student accounts from the Admin workspace. Physical-book stock is reduced only when the admin approves the payment; course access remains separate.

The main navigation opens All Courses directly without a promotional banner. Downloads is available in the main navigation, while Progress Reports is under Profile → My Learning.

E-books can have an optional, separate **Demo PDF**. Publish the paid e-book first, then open **Admin → E-Books → Add a Demo PDF** on its listed entry. Upload or replace a PDF up to 12 MB, preview it, or remove it without changing the paid book or its purchases. The **Demo** button appears beside the purchase/open action only when a demo is available. After signing in, anyone can view demo pages inside the app; the server sends watermarked page images, not the source PDF, and the demo viewer has no download button. E-books and learning-resource PDFs use a continuous, scrollable reader that loads protected pages as needed. As with other web readers, screenshots or saving rendered images cannot be completely prevented.

In **Admin → Publish Learning Resources → Current Affairs**, enter a resource title, choose a PDF (up to 12 MB), a video (MP4/WebM/MOV, up to 300 MB), or both, and set the publication date. Summary and Content are not required for new Current Affairs uploads; other resource sections keep their text forms. Students sign in to view protected PDF pages and videos inside the app, grouped by publication year and month. **Allow PDF and video downloads** is off by default and can be changed with the title/date under **Manage Published Content → Learning Resources → Edit**. Enabled items can be saved inside the app; PDF pages remain watermarked. To replace attachments, delete the resource and publish its replacement. Older text updates remain readable.

Payment checkout is also admin-configurable: save a UPI ID/payee, upload a PNG/JPEG/WebP QR image, then enable UPI, QR, or both. Admin approval of the submitted transaction reference remains mandatory before digital-course access is unlocked.

In **Admin → Upload a Study Book or Video**, select a course, subject and chapter (or add new names). Upload a PDF or an MP4, WebM or MOV video up to 300 MB. The form keeps the selected chapter after publishing so you can add both file types there. In **Admin → Courses → Open Course Content**, administrators can open a course and view its published materials directly. The workspace supports nested folders for course content and mock tests; create, rename, and move folders, and move books, chapter videos, or tests between folders. Students see the same folder structure in the course content and test views. Students can browse materials by subject and chapter and save eligible items to Downloads. Original PDFs stay private. **Manage Published Content** shows publication dates and provides edit and delete controls. Courses with purchase records and tests with student results cannot be deleted from the live admin dashboard.

Course PDFs, course videos, approved e-books, and eligible Current Affairs items can be saved to the app's origin storage and opened from Downloads after an online access check. Course pages are unmarked only when course downloads are enabled; other protected pages retain their watermark. Saved data is per account and device; clearing site data or running out of storage can remove or prevent saves, and large videos may exceed device storage or memory. Saved items are not available offline. The browser's storage and native screenshot protections are not DRM and cannot prevent a determined user from copying content or recall previously exported files. The copyright policy is in Profile → Copyright Policy; have legal counsel review it. Receipts, results, question papers and admin exports are unchanged.

Cloud Current Affairs video saving requires `firebase-media-cors.json` to be applied to the Storage bucket (including `GET` for the hosting origin); deploying Hosting or Functions alone does not apply bucket CORS. Course videos are streamed through the access-checking API. Test the bucket configuration and large videos on the target Android devices before release.

Mock-test creation offers a **Create Section-Wise Mock** mode. Import a separate PDF, DOCX, or TXT question file for each subject section, then publish a 100- or 200-question mock (one mark per question). The app checks the combined question count before publishing. Students can switch between sections during the test and review section scores after submission.

Referral credits are shown as rupee credits at checkout. Students can apply any available balance to a course; partial use reduces the amount that must be paid by UPI/QR. Fully covered requests still require admin approval. Admin rejection restores reserved credits. Syllabus has its own student destination and no longer shares the Previous Year Questions route.

### Firebase phone sign-in

1. Register a Web App in a Firebase project and enable **Phone** and **Email/Password** in Authentication. Configure the SMS region policy for India and add the actual web hostname to Firebase's authorized domains. Use a configured development HTTPS hostname and Firebase's fictional phone numbers to test without sending SMS.
2. Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, and `FIREBASE_AUTH_DOMAIN` from the web app configuration. These are client configuration values; do not use a service account key.
3. New accounts verify a phone by OTP and then set a unique username and password. The sign-in flow asks for a phone OTP followed by the account password. The password is checked in a separate, temporary Firebase session so the app retains the phone-authenticated token required by the API. Only a completed sign-in is saved on the device; it is restored on reopening until the user signs out, clears app storage, or Firebase invalidates the session. If account changes replace the phone token, the app asks the user to verify their phone again. Firebase Authentication manages the linked password credential, not SQLite or Firestore; the service does not collect an email address or store plaintext passwords. A sign-in password reset requires a recent phone verification. Profile password changes require the current password and use a separate, freshly authenticated Firebase session.
4. Sign in with each authorized admin's verified Indian mobile number. Copy the user's Firebase **UID** into the comma-separated `ADMIN_UIDS` list and restart. Administrators can publish courses, tests, and books and view support messages. Do not assign admin access by entering a phone number into `ADMIN_UIDS`.

For Firebase Hosting, the API function uses `PUBLIC_PROJECT_ID`, `PUBLIC_API_KEY`, and `PUBLIC_AUTH_DOMAIN` in the ignored `firebase-functions/.env.<project-id>` file, not the root `FIREBASE_*` settings. Obtain these public client values from the registered Firebase Web App; empty values prevent the sign-in form from loading. Add verified admin mobile numbers in international format to the comma-separated `ADMIN_PHONES` setting, preserving existing entries. Deploy the API and Hosting together after changing these settings.

If the browser reports `accounts:sendVerificationCode` with HTTP 400, inspect the JSON response in DevTools and the visible Mission Selection error:

- Enable **Authentication → Sign-in method → Phone**.
- Add `127.0.0.1`, `localhost`, and every deployed hostname under **Authentication → Settings → Authorized domains**.
- Under **Authentication → Settings → SMS region policy**, allow India for the target environment.
- Keep the Firebase web API key unrestricted by Google Cloud referrer rules, or explicitly allow the deployed HTTPS origin and localhost addresses.
- Real-number SMS requires the applicable Firebase Phone Auth quota/billing. Test with a configured fictional number during development.
- A console warning about falling back from reCAPTCHA Enterprise to reCAPTCHA v2 is not itself the failure.

### UPI payments and admin approval

Set `UPI_ID` and `UPI_PAYEE_NAME` to the receiving UPI account. The server creates the amount-specific QR locally; no payment page or third-party QR service is used. Students see the configured UPI details, pay in their own UPI application, and submit its transaction reference. Administrators use the same mobile sign-in, enter their Firebase UID in `ADMIN_UIDS`, and see the **Payment approvals** section.

An admin must independently verify the amount, reference, and receiving account before approving. Approval alone unlocks the purchased course, including requests fully covered by referral credits. Rejected requests include a reason and can be corrected and resubmitted by the student. Refunds, chargebacks, and entitlement revocation still require an operator process; do not enable live sales without one.

Older paid records without an approval status remain locked and appear as pending for admin review; records already marked approved remain approved. Previously generated cloud video storage links remain usable until they expire. Course-linked YouTube videos are only listed for approved purchasers and admins, but YouTube controls access to the underlying video and cannot prevent sharing a public YouTube URL.

### Publish courses and import tests

Create a course with a price, then add mock tests and e-books from the admin portal. Course cards and reviews are public; test questions, reading pages, and the course discussion group are restricted to purchasers and administrators. Each course has its own discussion group. Students can save a display name, submit a course review after purchase, and send support requests.

In a course's **Course Workspace**, create a folder under **Course Content** and upload a protected study PDF or a chapter video directly to it. Use **Edit Folder** to change its name or parent, or **Delete Folder** to delete it after confirmation. Deletion also permanently removes its subfolders, books, and videos. Under **Mock Tests**, create a folder and choose **Import Questions to Folder** to open the existing test publisher with that destination selected; import a PDF, DOCX, or TXT question file, review it, and publish. Existing books, videos, and mock tests can still be published through their usual admin forms and moved into folders from the workspace.

In **Admin → Mock Tests → Add Mock Test → Publish a Test**, choose **Test Creation Method → Create Test Manually** to enter questions without JSON. Add/remove questions and answer options, edit their text, optionally set sections, and select each correct answer. Tests require 1–200 questions, 2–6 non-empty options per question, and one correct answer. Removing the selected correct option requires choosing a new answer; removing an earlier option preserves the selected answer. **Import File / Questions (JSON)** remains available, and switching methods preserves each unpublished draft. Both methods use the same course, mock/live schedule, duration, marking settings, publishing API, student listings, exam room, and evaluation.

**Enable Question Paper Download after first completed attempt** applies to both mock and live tests, for either creation method. It is off by default and can also be changed under the existing test's **Edit** controls. Students must retain course access and complete an attempt before downloading; disabling the switch blocks subsequent paper requests. Result PDF downloads remain unchanged.

Enter questions manually or import an English or Gujarati **text-based PDF**, UTF-8 text file, or `.docx` (up to 12 MB, 1–200 questions). For example:

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

The importer accepts `1.`, `Q1.`, or `પ્રશ્ન ૧:` question numbers, choices such as `A.` or `(A)` (including side-by-side choices), and `Answer: B`, `જવાબ: (B)`, or `સાચો જવાબ: (B)` answer lines. Number/letter answer-key tables at the end of the document are matched by source question number, not row order. Use consistent question prefixes throughout the file; `Q`/`પ્રશ્ન` prefixes distinguish questions from numbered statements or matching lists inside them.

After import, edit question text, choices, sections, and correct answers directly under **Imported Questions**, without editing JSON. Yellow **Needs review** cards identify missing/conflicting answers, malformed choices, or unreadable text; no correct answer is guessed. Resolve the warnings before publishing. PDFs with broken Unicode font mappings show `�` where text could not be recovered; compare with the original and repair that text, or import a Unicode DOCX/TXT export. Scanned PDFs need OCR first, and legacy `.doc` files need conversion. Arbitrary newspaper-style question columns are not supported.

The reader serves page images, not the original PDF. Protected pages may contain a phone-number watermark, except for courses whose downloads are enabled. Disclose this to students before offering paid content.

## Deploy and install on Android

On the Firebase site, new courses require an expiry date. The selected day is included through 11:59 p.m. India time; at the next midnight, purchases and student access to course materials close. Existing courses without a date are unchanged until an admin sets one in **Manage Published Content**. New courses, PDF study books, and physical books require 1–8 distinct JPEG, PNG, or WebP covers (up to 6 MB each). Covers are resized for the web and are public; do not use private information or protected book pages as covers. Multiple covers appear in a swipeable gallery.

On Firebase Hosting, deploy the Hosting site and its pinned API function together. Chapter videos and Current Affairs files upload directly to the private Cloud Storage bucket using signed PUT URLs, rather than passing large request bodies through Hosting or Functions. Apply [firebase-media-cors.json](./firebase-media-cors.json) to the media bucket (merge with any existing CORS rules first). The function runtime service account needs `iam.serviceAccounts.signBlob` on its own identity and object read, create and delete access to the private media bucket. Firebase Storage rules should continue to deny direct client access. Only the API issues time-limited URLs after checking the relevant signed-in student, admin, or purchaser access.

Run one service instance behind an HTTPS reverse proxy on a host with a persistent volume. Set `DATA_DIR` to a private, backed-up directory; use a SQLite-aware backup while the service is running. Install the same OS document tools as above, supply environment variables through the host's secret store, and run under a dedicated unprivileged user. Configure the proxy to accept the application's 12 MiB binary-upload limit. If a local reverse proxy is the only caller and overwrites `X-Forwarded-For`, set `TRUST_LOCAL_PROXY=true` to apply rate limits per client. Do not expose the database directory or run multiple replicas with independent disks. Review provider quotas, monitoring, privacy disclosures, and support operations before going live.

- **Android browser:** Open the deployed HTTPS origin in Chrome and use **Install app** or **Add to Home screen**. The app requires connectivity for sign-in, purchases, and course content.
- **Android video fullscreen:** The secure WebView wrapper generated by `android/init-project.mjs` supports YouTube fullscreen, switches to landscape, and restores the previous orientation on exit or Back. The video library also has a landscape fullscreen button. Orientation changes keep the player alive. Existing APK installations need a rebuilt app; a Hosting deploy cannot add native fullscreen callbacks to an installed APK.
- **Android file selection:** Version 20 of the generated secure WebView wrapper opens the system document picker for all HTML file inputs, including course files, Current Affairs, e-books, covers, and QR images. It honors accepted file types and multiple selection, handles cancellation, and reads only user-selected content URIs without requesting broad storage access. Rebuild and install the signed APK to fix existing installations; deploying the website alone cannot add this native callback.
- **Android UI:** The generated secure WebView renders the same routes and components as the hosted site. The Material-inspired tokens, responsive layouts, and component treatments are in [`public/assets/android-design.css`](./public/assets/android-design.css). Validate the same screens in Chrome at narrow widths and in the installed app; the latter also checks system bars and the soft keyboard.
- **Android APK/AAB:** `android/package.sh` documents how to generate a Trusted Web Activity with Bubblewrap from the deployed web manifest, build it, and verify association using `android/assetlinks.example.json`. Copy the configured file to `public/.well-known/assetlinks.json` and restart the service. A signed Android package requires your origin, package ID, and signing key.
- **Google Play:** This version uses UPI payment requests outside an integrated gateway. Before distributing an APK/AAB through Google Play, review the applicable digital-goods billing policy; this project does **not** implement Play Billing or an enrolled alternative-billing flow.