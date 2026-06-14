# Bluesky Manager

An installable **PWA** to sign in to your Bluesky account and **mass-follow** users via the AT Protocol API. Runs entirely in the browser (no backend) and is ready to deploy to **Vercel**.

## Features

- **Sign in** with your handle/email + an **App Password**. Sessions persist on-device and auto-resume.
- **Build a follow list** three ways:
  - **Paste handles** — one handle, DID, or `bsky.app/profile/...` URL per line.
  - **From an account** — pull the *followers* or *following* of any account.
  - **Search** — find users by name/keyword.
- **Review** targets, deselect anyone, and optionally **skip people you already follow**.
- **Mass follow** with a configurable delay (rate-limit friendly), live progress bar, per-user log, automatic back-off, and a **Stop** button.
- **Installable PWA** — add to home screen / desktop, works offline for the app shell.

## Tech

- [Vite](https://vitejs.dev/) + [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/)
- [`@atproto/api`](https://www.npmjs.com/package/@atproto/api) (`AtpAgent`), called directly from the browser (Bluesky XRPC endpoints support CORS)

## Local development

```bash
npm install
npm run dev      # start dev server
npm run build    # production build -> dist/
npm run preview  # preview the production build
```

### Create an App Password (recommended)

1. In Bluesky: **Settings → Privacy and security → App Passwords**.
2. Create a new app password.
3. Sign in with that value (`xxxx-xxxx-xxxx-xxxx`) instead of your main password.

## Deploy to Vercel

### Option A — GitHub + Vercel dashboard

```bash
git init
git add .
git commit -m "Bluesky Manager PWA"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in Vercel: **New Project → Import** the repo. The included `vercel.json` sets the framework (Vite), build command, and output directory automatically — just click **Deploy**.

### Option B — Vercel CLI

```bash
npm i -g vercel
vercel        # preview deploy
vercel --prod # production deploy
```

## Security note

This is a fully client-side app. When you choose to stay signed in, the AT Protocol session (and, for credential fallback, your app password) is stored in your browser's `localStorage` on your own device. Use a revocable **App Password**, and sign out to clear it. Nothing is ever sent to any server other than your Bluesky PDS (`bsky.social` by default).

## Project structure

```
index.html            # app shell (Vite entry)
vite.config.js        # Vite + PWA config (manifest, service worker)
vercel.json           # Vercel deploy config
public/
  icon.svg            # PWA / app icons
  icon-maskable.svg
  favicon.svg
src/
  main.js             # UI logic
  bsky.js             # browser AT Protocol client (login, follow, search…)
  styles.css          # styling
```
