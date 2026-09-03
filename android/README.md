# RINGO 3D on Google Play

A Trusted Web Activity: the Play app is a thin Android shell around the live
site at ringo3d.beelinemicrosystems.com. There is no second copy of the game
to maintain — deploying the web client updates the app too, with no store
review. The wrapper only needs rebuilding when the app's own identity
changes: its name, icon, colours, version or package id.

## Rebuild

```bash
cd android
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
export BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat keystore-password.txt)"
export BUBBLEWRAP_KEY_PASSWORD="$BUBBLEWRAP_KEYSTORE_PASSWORD"
./node_modules/.bin/bubblewrap build --skipPwaValidation
```

Output: `app-release-bundle.aab` for Play, and `app-release-signed.apk` for
sideloading onto a phone to try it.

`bubblewrap update` regenerates the Android project after editing
`twa-manifest.json`, and bumps the version code. Play needs the version code
to increase with every upload.

## The signing key

`android.keystore` with the password in `keystore-password.txt`. Both are
gitignored and exist only on this machine — **back them up somewhere safe.**
This is the *upload* key. With Play App Signing switched on, Google holds
the real app signing key, so losing this one is recoverable by requesting an
upload key reset, but it is still a nuisance.

## Domain verification

`public/.well-known/assetlinks.json` proves the app and the site belong to
the same owner. Without a match, the app shows a browser address bar across
the top instead of running full screen.

For this app Play uses the **upload key as the app signing key**, so there is
only one certificate on the App signing page and the file needs only that one
fingerprint, `47:9E:F8:9D...`. It is already there and verified.

If Play ever regenerates or adds a separate app signing key, add it too:

1. Play Console, with **RINGO 3D selected in the app switcher**, then App signing
2. Copy the SHA-256 under **App signing key certificate**
3. `./node_modules/.bin/bubblewrap fingerprint add <sha256> --name "play app signing"`
4. `./node_modules/.bin/bubblewrap fingerprint generateAssetLinks --output ../public/.well-known/assetlinks.json`
5. `cd .. && ./scripts/deploy-web.sh`

**Check the app switcher before copying anything.** The App signing page shows
whichever app is selected, with nothing on the page naming it, so it is very
easy to copy another app's key. The tell is the upload key: on RINGO 3D it
reads `47:9E:F8:9D...`. If it doesn't, you are on a different app.

`bubblewrap fingerprint list` shows what is registered, and `remove <sha256>`
takes one out.

**Chrome caches the verdict, including failures.** After changing the file, a
force stop is not enough. Uninstall the app, clear Chrome's cache, then
reinstall.

## Browsers, and the address bar

A Trusted Web Activity only runs full screen when the device's default
browser can act as a TWA provider, and the helper library accepts only
Chrome and its beta/dev/canary builds. On a phone defaulting to Brave,
Firefox, Samsung Internet or anything else, the app would otherwise open as
a Custom Tab, which always shows a non-editable address bar across the top.

`twa-manifest.json` therefore sets `"fallbackType": "webview"`. With Chrome
present the app uses the real TWA path, which shares storage with the
browser; without it, the app falls back to an embedded view that has no
address bar. Do not set this back to `customtabs` — that is what put the bar
there in the first place.

An address bar on a device that *does* have Chrome means something else:
either the verification file does not list the signing key Play used, or
Chrome cached an earlier failed check. Force stop the app, and reinstall if
that doesn't clear it.

## Store listing notes

- **Data safety**: the game stores no personal data. A visit is recorded as
  a timestamp with no address and no identifier; rate-limit counters key on
  a salted hash. Player and room names are typed per game and vanish with
  the room. There is no chat, no accounts, no ads and no analytics SDK.
- **Assets to hand**: icon at `public/icons/icon-512.png`, phone and desktop
  screenshots in `public/screenshots/`, and `public/og.png` works as a
  feature graphic after cropping to 1024x500.
