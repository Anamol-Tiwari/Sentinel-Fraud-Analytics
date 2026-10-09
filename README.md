# Sentinel Fraud Analytics

## Deploy to Vercel

The Vite application and its npm lockfile are in [`web/`](./web/). When importing
this repository into Vercel, set **Root Directory** to `web` and leave
**Include files outside the root directory in the Build Step** disabled. Vercel
will install dependencies from `web/package-lock.json`, run `npm run build`, and
publish `web/dist`.

The `web/vercel.json` configuration routes app URLs to the SPA entry point, so
client-side routes also work when opened directly or refreshed.
