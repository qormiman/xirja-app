# Building a real, sideloadable Android app (personal use)

This is the third and final step toward having Xirja permanently installed
on your own Android phone, after real navigation and Shopping mode's
persistence (both done and confirmed). Unlike everything so far, this step
needs a terminal, not just Snack or a GitHub upload — the build itself runs
on Expo's servers, but you kick it off from a command line in this project
folder.

Two new files are part of this: `app.json` (added `android.package`, a
unique id Android uses to identify the app — `com.xirja.app`, fine to leave
as-is for personal use) and `eas.json` (the build configuration itself,
telling Expo's build service to produce a plain installable `.apk` rather
than the `.aab` format the Play Store wants).

**On a locked-down work laptop, this uses GitHub Codespaces** — a free,
browser-based dev environment tied to your GitHub account, with Node.js
already installed there. Nothing installs on your actual laptop; it's a
tab in your browser, the same way Snack is. (If you ever do this from a
personal computer instead, the only difference is opening a normal
terminal there with Node.js installed, instead of steps 1–2 below —
everything from step 3 onward is identical either way.)

## 1. Open a Codespace on the `xirja-app` repo

1. Go to your `xirja-app` repository on github.com.
2. Click the green **Code** button → the **Codespaces** tab → **Create
   codespace on main** (or whatever your default branch is called).
3. Wait for it to load — it opens a full VS Code editor right in your
   browser tab, with a terminal panel already available (usually at the
   bottom; if you don't see it, `` Ctrl+` `` opens one). This can take a
   minute or two the first time.
4. In that terminal, confirm Node.js is there:
   ```
   node -v
   ```
   It should print a version number immediately — nothing to install.

Free GitHub accounts get a monthly allowance of Codespaces hours, which is
far more than this occasional task needs. Delete the Codespace when you're
done for the day (its own three-dot menu, or from github.com/codespaces)
so you're not leaving it running idle — you can always create a fresh one
next time you need to rebuild.

## 2. Create a free Expo account

Go to [expo.dev/signup](https://expo.dev/signup) and sign up (email +
password, or GitHub sign-in). This is Expo's own account system — separate
from GitHub — and it's what lets their servers build the app for you and
hand you back an installable file. Free tier is fine for this.

## 3. Make sure the project's dependencies are installed

In the Codespace's terminal (you're already in the project folder — the
Codespace opens directly inside the repo it was created from):

```
npm install
```

This reads `package.json` and downloads everything the app needs into a
`node_modules` folder. Takes a minute or two.

## 4. Install the EAS command-line tool and log in

```
npm install -g eas-cli
eas login
```

Enter the Expo account email/password from step 2 when prompted.

## 5. Link this project to your Expo account

```
eas init
```

This asks to confirm creating a new project on your Expo account (say
yes) and adds a `projectId` to `app.json` automatically — that's the one
part of this setup I can't do for you from here, since it has to be tied
to your own account.

## 6. Start the build

```
eas build --platform android --profile preview
```

This uploads the project to Expo's build servers and builds it there — it
does NOT build on the Codespace itself (or your laptop), so this works
regardless of how modest either one is. It typically takes 10–20 minutes;
you can watch progress right there in the terminal, or it'll give you a
link to watch on expo.dev. You can close the Codespace tab once the upload
finishes and the build has started if you don't want to keep it open and
counting against your free hours — the build keeps running on Expo's
servers either way, and the download link at the end works from anywhere.
Once done, you'll get a link to download a `.apk` file.

## 7. Get the `.apk` onto your phone and install it

Easiest ways:

- Open the download link Expo gives you directly in your phone's browser
  (if you're signed into the same Expo account there, or just paste the
  link) and download it there, or
- Download the `.apk` on your PC, then transfer it to your phone (email it
  to yourself, use Google Drive/OneDrive, or a USB cable).

Then, on your Android phone, open the downloaded `.apk` file. Android will
likely warn that it's blocking installs from this source the first time —
tap through to **Settings** and allow installs from that specific app
(Chrome, Files, or whichever app you used to open it), then go back and
tap the `.apk` again to install. This is normal for any app installed
outside the Play Store, not a red flag specific to this build.

## After that

The app is now a real, permanent install — no Snack, no cable, no dev
server needed to open it day-to-day. If you ever change `App.js` again,
you'd repeat step 6 (`eas build ...`) to get a fresh `.apk` with the
update, and reinstall it the same way (Android will treat it as an
update to the existing app rather than a second copy, since the package
name in `app.json` stays the same). On the Codespace side, next time you
need to rebuild, you can create a fresh Codespace (or reopen the same one
from github.com/codespaces if you didn't delete it) and jump straight to
step 3 — `npm install` — since `eas login`/`eas init` won't be needed again
unless it's a brand-new Codespace with no saved login.

One thing to know for later: this build profile (`preview`) is meant
exactly for this — a real, installable file for testing/personal use, not
for the Play Store. If Xirja ever gets far enough to consider a public
release, that's a separate, larger step (a Play Store developer account,
a different build profile, listing requirements, review process) — worth
its own conversation when you're actually there, not something to solve
now.
