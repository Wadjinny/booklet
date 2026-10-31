# Booklet maker

Turn any PDF into a printable **cut & fold booklet**, entirely in the browser. Your PDF never leaves your device.

Pick 2, 4, 8 or 16 booklet pages per side of the paper, preview every sheet (front and back, with pinch / Ctrl+scroll zoom), then download a PDF with cut lines, fold lines and strip numbers. A step-by-step guide shows how to print, cut, stack, fold and bind the result.

## Features

- **2 / 4 / 8 / 16 pages per side**, cut & stack imposition: cut the sheets into strips, stack them by number, fold once
- **Double-sided printing**: flip on long or short edge, or "one side only" mode (separate fronts / backs files, optional reversed backs)
- Paper sizes A3, A4 (default), A5, Letter, Legal, Tabloid; auto, portrait or landscape sheet
- Split thick documents into **up to 5 booklets**
- Page range, blank pages at the start, fill-up blanks at the end or before the back cover, right-to-left reading
- Page fitting: fit, fill, stretch or 100%; auto-rotate; margins, fold margin, paper border, creep compensation
- Optional page numbers (position, start number, size, skip cover)
- Marks: dashed cut lines or edge ticks, fold lines, strip numbers, sheet labels, mark color
- Mobile-first UI, settings remembered in the browser

## Run

Requires Node.js 20+ and pnpm. The app lives in `frontend/`.

```bash
cd frontend
pnpm install
pnpm dev           # dev server at http://localhost:5173
```

Production build (static files in `frontend/dist/`):

```bash
pnpm build
pnpm preview       # serve the build at http://localhost:4173
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which uses the shared [Wadjinny/workflows](https://github.com/Wadjinny/workflows):

1. `deploy-pnpm-vite.yml` builds `frontend/` and rsyncs `dist/` to `$SSH_DEPLOY_DIR/booklet` on the VPS.
2. `deploy-caddy-site.yml` installs `Caddyfile` as `/etc/caddy/sites/booklet.conf` and reloads Caddy.

Live at https://booklet.w-ilyas.site and https://booklet.w-ilyas.ink.

Required repo secrets: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_DEPLOY_DIR` (see `ignored/secrets.env.example` in the workflows repo).

## How it works

- `frontend/src/lib/plan.js` computes the imposition: grid choice, page order per strip, front/back placement for the chosen duplex flip edge, and the cut & stack order.
- `frontend/src/lib/build.js` writes the output PDF with [pdf-lib](https://pdf-lib.js.org/). Source pages are embedded as vectors, so text stays sharp.
- `frontend/src/lib/render.js` renders the preview with [pdf.js](https://mozilla.github.io/pdf.js/).
- UI: Vue 3 + Vite (`frontend/src/App.vue`, `frontend/src/components/`).
