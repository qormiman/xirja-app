# Xirja app — now a real, persistent project

This folder is the same "My list" screen that was working in Expo Snack
(the browser scratchpad), turned into a real, permanent project — the exact
next step Snack's own instructions said to take once that screen was
confirmed working. The screen itself hasn't changed: same `App.js`, same
real API connection. What's different is that this is now a normal project
folder with the pieces (`package.json`, `app.json`) that make it installable,
runnable on your own computer, and — most importantly — saveable to GitHub,
so it can never again exist only inside a temporary session.

## 1. Save this to GitHub (do this first, before anything else)

This is the single most important step — it's what makes this project
permanent instead of something that could disappear again.

1. Go to [github.com](https://github.com) and sign in (same account as
   `xirja-backend`).
2. Click the **+** in the top right → **New repository**.
3. Name it `xirja-app`. Private or public, your choice — doesn't need to
   match `xirja-backend`'s setting.
4. Click **Create repository**.
5. On the new repository's page, click **uploading an existing file** (or
   **Add file → Upload files**).
6. Drag in every file from this folder — `App.js`, `SETUP.md`,
   `package.json`, `app.json`, `babel.config.js`, `.gitignore` — keeping
   them all at the top level (no subfolder).

   Note: some computers hide files starting with a dot (like `.gitignore`)
   in Finder/Explorer by default. If you don't see it, that's just a
   display setting — it's still in this folder. Uploading it isn't
   critical (it only matters once you `npm install` locally — see below),
   so don't worry if it doesn't make it into this first upload.
7. Click **Commit changes**.

That's it — from this point on, this project lives on GitHub exactly like
`xirja-backend` does, independent of any one computer or session.

## 2. Keep testing it the easy way (Expo Snack), or move to running it locally

**Nothing changes about how you test it today.** Expo Snack still works
exactly as before: go to snack.expo.dev, paste in `App.js`, scan the QR
code with Expo Go on your phone. That's still the fastest way to check
something quickly, and it doesn't require anything installed on your
laptop.

**When you're ready to run the real project folder itself** (needed once
there's more than one file, e.g. once "Browse" or "Compare" get built) —
that requires Node.js on your computer, unlike Snack:

1. Install [Node.js](https://nodejs.org) (the "LTS" version) if you don't
   have it already.
2. Open a terminal/command prompt in this folder and run:
   ```
   npm install
   ```
   This downloads everything the project needs (React Native, Expo, etc.)
   into a `node_modules` folder — this can take a few minutes the first
   time, and that folder can get large; it's deliberately excluded from
   what gets uploaded to GitHub (see `.gitignore`) since it can always be
   recreated by running this command again.
3. Run:
   ```
   npx expo start
   ```
   This shows a QR code right in your terminal. Scan it with Expo Go on
   your phone (Camera app on iPhone, Expo Go itself on Android), same as
   with Snack.

## 3. Where this is heading

This one screen ("My list", showing 4 hardcoded categories with real
prices) is the very first slice, proving the phone-to-database connection
works. Still ahead, in rough order: turning this into real navigation
across the other 8 designed screens, replacing the hardcoded category list
with the real `app_list` / `app_list_item` tables (so items can actually be
added/removed), and the price-correction workflow. None of that has to be
figured out now — just flag it back to me once GitHub has this saved and
you're ready for the next screen.
