# Norte browser extension

Save the current page's rendered HTML to a Norte server, including text available only
in a logged-in browser. Saving does not wait for extraction. The popup reports success
as soon as the server returns an item ID, and offers a link to `/library/<id>`.

## Build and install

From this directory:

```sh
npm ci --ignore-scripts
npm run build
```

The output is `dist/chromium/` and `dist/norte.zip`. In Chromium, enable developer mode
at `chrome://extensions` and load the unpacked directory. Open the extension's settings,
enter the server origin (default `http://127.0.0.1:8080`), and choose Connect. The browser
asks for permission to that origin; settings persist only after `/api/health` returns 200.
No host access is granted by the release manifest at installation. No CORS configuration
is needed on the server.

Click the toolbar action while viewing an article. Save receives initial focus; Enter
submits. The reason and one subject or focus target are optional. Subject search loads
all result pages. Closing the popup leaves the background request running; reopening it
on the same URL shows the stored result. Results for other URLs are not displayed.

The content script captures `document.documentElement.outerHTML` and a selection quote
with up to 32 Unicode code points on each side. It does not capture iframe documents,
shadow roots, canvas pixels or form state that is not reflected in HTML attributes.
The server receives the rendered snapshot, so sensitive page content is sent to the
configured server. A 413 is displayed without retrying a URL-only save. Browser internal
pages, extension stores, and pages where injection is blocked cannot be saved.

A single Manifest V3 file declares both background implementations: Chromium uses the
module service worker and Firefox uses the module background script. Firefox 140 or
later is required. The Firefox linter warns that it ignores `service_worker`; the
`scripts` entry is its supported implementation. See [MDN's background compatibility
reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).

## Tests

From the repository root, run only the checks needed:

```sh
bin/ci extension-test
bin/ci extension-e2e
bin/ci extension-firefox
```

The first check installs the pinned test dependencies when they are missing, runs the Node
unit tests and builds the release directory and ZIP. The browser check builds the server
binary, starts `norte serve` with temporary data and configuration, and loads the extension
in Chromium. It does not rebuild the frontend, so a standalone run whose reader assertion
matters wants `bin/generate web` first; the full gate has already done that.
Set `CHROMIUM_BIN` to use a specific browser. If no system Chromium is available, the gate
downloads Playwright's Chromium into `extension/artifacts/browsers`. System dependencies
must already be installed; the check does not install machine packages.

The fixture requires a cookie; an unauthenticated fetch gets 401. A local proxy records
save requests and forwards them to the real server. Tests assert the rendered HTML,
selection, reason, focus link, source, single POST, extraction result and reader text.
They also cover a closed popup, URL-specific results, a missing server permission, 413,
restricted pages and an unavailable server. All child servers and browsers are owned
and stopped by the foreground test process.

`node build.mjs --test-origin http://127.0.0.1:12345` emits `dist/test/` and
`dist/norte-test.zip`, adding only that fixture origin to `host_permissions`. Release
builds are separate and always omit it. The browser harness calls the same builder with
a temporary output directory. Chromium's permission prompt is not automated; the exact
`permissions.request` call is covered with a stub. Playwright loads the actual popup
document with the article tab active; fixture-only access substitutes for the toolbar's
`activeTab` gesture. The no-server-grant case configures a different, ungranted origin.

To rerun one assertion after the server build:

```sh
cd extension
node --test --test-name-pattern='exactly 32' tests/capture.test.mjs
npx playwright test --grep 'closing the popup'
```

The Firefox check always runs `web-ext lint`. When Firefox is available (or `FIREFOX_BIN`
is set), it temporarily loads the built extension in headless Firefox and checks that
its background responds to a message from the popup document. Otherwise it prints an
explicit skip reason. It does not claim
to exercise the interactive Firefox popup or POST.

## First-delivery manual acceptance

These steps require an interactive browser and a real account; automated fixture tests
do not replace them. Record their results in the delivery review.

1. In Chromium, open a real Substack post behind login, open the extension, optionally
   enter a reason, and save. Verify the post's actual text appears in Norte's reader.
2. In Firefox, load `dist/chromium/manifest.json` through `about:debugging`, configure the
   server with its permission prompt, open an article, and use the popup to save it.
   Verify one POST and the article text in the reader.
3. Repeat Save while closing the popup, reopen it on the same page, and check the result.

Neither real-account acceptance nor the interactive Firefox walk is part of CI: launching
Firefox through `web-ext` gives the test no channel to assert the POST, and Chromium's
permission prompt cannot be accepted by automation.

## Development dependencies

`web-ext` is only used by the Firefox check and is absent from the loadable extension and the
ZIP. It reaches `node-forge` through its Android tooling, so `npm audit` reports three high
entries that no published `web-ext` release fixes without dropping to a major version that
cannot lint Manifest V3. The `shell-quote` override pins the one advisory in that tree that
does have a patched release.
