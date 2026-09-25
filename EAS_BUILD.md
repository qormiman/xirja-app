# Building a real, sideloadable Android app (personal use)

This is the third and final step toward having Xirja permanently installed
on your own Android phone, after real navigation and Shopping mode's
persistence (both done and confirmed). Unlike everything so far, this step
needs a terminal on your PC, not just Snack or a GitHub upload — the build
itself runs on Expo's servers, but you kick it off from a command line in
this project folder.

Two new files are part of this: `app.json` (added `android.package`, a
unique id Android uses to identify the app — `com.xirja.app`, fine to leave
as-is for personal use) and `eas.json` (the build configuration itself,
telling Expo's build service to produce a plain installable `.apk` rather
than the `.aab` format the Play Store wants).

## 1. Check whether you have Node.js

Open a terminal (PowerShell — search "PowerShell" in the Start menu) and run:

```
node -v
```

- If you see a version number (e.g. `v20.11.0`), you're set — skip to step 2.
- If you see an error like "not recognized", install it: go to
  [nodejs.org](https://nodejs.org), download the **LTS** version, run the
  installer (accept the defaults), then close and reopen PowerShell and
  run `node -v` again to confirm.

## 2. Create a free Expo account

Go to [expo.dev/signup](https://expo.dev/signup) and sign up (email +
password, or GitHub sign-in). This is Expo's own account system — separate
from GitHub — and it's what lets their servers build the app for you and
hand you back an installable file. Free tier is fine for this.

## 3. Open a terminal in the project folder

In PowerShell:

```
cd "C:\Users\rannier.chircop\Documents\Xirja App\xirja-app"
```

## 4. Make sure the project's dependencies are installed

```
npm install
```

This reads `package.json` and downloads everything the app needs into a
`node_modules` folder. Takes a few minutes the first time. If you've run
this before in this folder, it'll just confirm everything's already there.

## 5. Install the EAS command-line tool and log in

```
npm install -g eas-cli
eas login
```

Enter the Expo account email/password from step 2 when prompted.

## 6. Link this project to your Expo account

```
eas init
```

This asks to confirm creating a new project on your Expo account (say
yes) and adds a `projectId` to `app.json` automatically — that's the one
part of this setup I can't do for you from here, since it has to be tied
to your own account.

## 7. Start the build

```
eas build --platform android --profile preview
```

This uploads the project to Expo's build servers and builds it there — it
does NOT build on your own PC, so this works even on a modest laptop. It
typically takes 10–20 minutes; you can watch progress in the terminal, or
it'll give you a link to watch on expo.dev. Once done, you'll get a link to
download a `.apk` file.

## 8. Get the `.apk` onto your phone and install it

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
you'd repeat step 7 (`eas build ...`) to get a fresh `.apk` with the
update, and reinstall it the same way (Android will treat it as an
update to the existing app rather than a second copy, since the package
name in `app.json` stays the same).

One thing to know for later: this build profile (`preview`) is meant
exactly for this — a real, installable file for testing/personal use, not
for the Play Store. If Xirja ever gets far enough to consider a public
release, that's a separate, larger step (a Play Store developer account,
a different build profile, listing requirements, review process) — worth
its own conversation when you're actually there, not something to solve
now.
