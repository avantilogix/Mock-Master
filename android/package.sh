#!/bin/sh
set -eu

# 1. Deploy Mock Master at the root of your canonical HTTPS origin. Serve
#    public/manifest.webmanifest and public/icons/ at /manifest.webmanifest
#    and /icons/. Link it in <head>:
#    <link rel="manifest" href="/manifest.webmanifest">
#    <meta name="theme-color" content="#172554">
#    In Android Chrome, open the deployed page and choose Install app under
#    Add to Home screen when offered. Launch from the installed icon to check
#    that the app opens at / in standalone mode; a shortcut is not the same.
#
# 2. Install Bubblewrap with `npm install --global @bubblewrap/cli@1.27.0`
#    (use a supported Node.js LTS, without sudo). Run the init command below
#    using your actual origin. Accept Bubblewrap's JDK/Android SDK setup as
#    needed. In the prompts keep Mock Master for both names, / as the start
#    URL, standalone display, default orientation and #172554 for both colors.
#    Confirm the normal and maskable icons and choose a unique, permanent
#    Android package ID under a namespace you control. Keep the upload
#    keystore outside this checkout, back it up and never commit passwords.
#
# 3. Run build. Install generated/app-release-signed.apk on a test device
#    with the install command, or upload generated/app-release-bundle.aab
#    through Play Console (paths relative to android/). Check the generated
#    target SDK against current Play requirements before uploading. Enable
#    Play App Signing and use your upload key to sign the bundle.
#
# 4. Copy assetlinks.example.json as /.well-known/assetlinks.json on the
#    exact launch origin (HTTP 200, no redirects, Content-Type: application/json).
#    Replace the package ID placeholder with the generated project's exact ID.
#    Replace the fingerprint with the colon-separated SHA-256 of the Play
#    APP SIGNING certificate from Play Console's App integrity page, not
#    the upload certificate. For a locally installed APK, add the SHA-256
#    of its signing certificate only on an origin where it should be trusted
#    (`keytool -list -v -keystore <keystore> -alias <alias>`).
#    Verify on the device: the matched build should open without a browser
#    toolbar. Use a Play testing track to confirm the Play-signed install;
#    a toolbar fallback can indicate a missing or mismatched association.
#
# 5. For future releases, retain the package ID and upload key. Keep a safe
#    copy of the generated twa-manifest.json configuration outside the repo.
#    Run `bubblewrap update` in android/generated to regenerate and increment
#    the version code, then rebuild. Recheck DAL if the origin or signing
#    certificate changes.

usage() {
  printf '%s\n' 'Usage: sh android/package.sh init HTTPS_ORIGIN | build | install' \
    'Generated project and release artifacts are written to android/generated/.'
}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  init) [ "$#" -eq 2 ] || { usage >&2; exit 1; } ;;
  build|install) [ "$#" -eq 1 ] || { usage >&2; exit 1; } ;;
  *) usage >&2; exit 1 ;;
esac

project="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/generated"
command -v bubblewrap >/dev/null 2>&1 || fail 'Install Bubblewrap first (see android/package.sh).'

if [ "$1" = init ]; then
  origin="$(node -e '
    const input = process.argv[1];
    try {
      const url = new URL(input);
      if (url.protocol !== "https:" || ![url.origin, url.origin + "/"].includes(input)) {
        process.exit(1);
      }
      console.log(url.origin);
    } catch {
      process.exit(1);
    }
  ' -- "$2")" || fail 'Pass the canonical HTTPS origin only, optionally with a trailing slash.'
  mkdir -- "$project" || fail 'Cannot create android/generated. If it already exists, preserve or move it before initializing again.'
  cd -- "$project"
  exec bubblewrap init --manifest="$origin/manifest.webmanifest"
fi

[ -f "$project/twa-manifest.json" ] || fail 'Initialize the Android project first.'
cd -- "$project"
exec bubblewrap "$1"
