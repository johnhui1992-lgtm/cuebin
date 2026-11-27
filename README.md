# Cuebin

Personal song inbox: paste YouTube links, listen while you work, filter by mood / type / singer.

Playlist syncs to Postgres per signed-in Cursor viewer (`GET`/`PUT /api/playlist`). `localStorage` stays as cache and offline fallback.

```bash
npm install
npm run dev    # http://127.0.0.1:3000
npm run build
```
