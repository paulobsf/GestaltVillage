# Gestalt Village

Gestalt Village is a browser-native multi-agent social simulation. Give it a short scenario and watch a small cast of pixel-art residents move, talk, remember, and change how they see one another over time.

![Gestalt Village overview](docs/screenshots/app-overview.png)

## Highlights

- Fully static and browser-native; no backend or build output required
- Pixel-art floor-plan world with live movement, speech bubbles, and relationship shifts
- Local model inference in a Web Worker using WebGPU via Transformers.js
- Inspectable thoughts, memories, trust changes, and private office conversations

## What it is

Gestalt Village is a fully client-side web app that:

- Takes a freeform prompt describing a setting and its inhabitants
- Generates a compact pixel-art world with rooms and agents
- Runs local AI conversations entirely in the browser using WebGPU
- Exposes an inspector to observe each agent's thoughts, memories, and relationships
- Keeps everything local after the initial model download

The model runs via [Transformers.js](https://huggingface.co/docs/transformers.js) and is cached in the browser after the first load.

## How it works

The simulation runs as a tight loop. On each **tick**, every agent calls the model to decide its next action: wait, move to a room, or start a conversation with someone nearby.

When two agents are in the same room and one decides to talk, the model generates dialogue turn by turn. After each utterance, the main thread updates both participants' memory and their trust or rapport toward one another. A conversation ends when the model decides it is done or the maximum turn count is reached.

All inference happens inside a **Web Worker**, which keeps the UI responsive. The model is downloaded once from the Hugging Face CDN and cached locally via the service worker.

The main thread owns all simulation state: rooms, agents, memories, relationships, and the current tick. It sends a snapshot of each agent's context to the worker for every model call, so the worker stays stateless and has no DOM access.

## Browser requirements

- A modern Chromium-based browser with **WebGPU support** enabled
- Chrome/Edge 113+ and Firefox Nightly with the `dom.webgpu.enabled` flag
- Safari Technology Preview (WebGPU available but may require additional setup)

For the smoothest experience, use a recent Chromium-based browser with WebGPU enabled.

## Run locally

### Option 1: With Node

Start the dev server:

```bash
npm run dev
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

### Option 2: Without Node

Any static file server works. For example:

```bash
# Python 3
python -m http.server 4173

# PHP
php -S 127.0.0.1:4173

# Bun
bunx serve .
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173).

> **Note:** `npm run dev` sends `Cache-Control: no-store` to reduce stale-browser-cache issues during development. If you use your own static server, an incognito window or disabled cache in dev tools helps.

## Project structure

```
gestalt-village/
├── index.html              Entry point
├── styles.css              Styles
├── sw.js                   Service worker (must stay at root)
│
├── src/
│   ├── app.js              Main application logic
│   ├── config.js           Model and app configuration
│   ├── constants.js        Shared constants
│   ├── dom.js              DOM utility helpers
│   ├── state.js            Simulation state management
│   ├── utils.js            General utilities
│   ├── render/
│   │   └── world.js        Canvas world rendering
│   ├── ui/
│   │   ├── log.js          Conversation log
│   │   └── panels.js       Inspector, prompt, telemetry panels
│   └── workers/
│       └── reasoning-worker.js Web Worker that runs the model
│
├── dev/                    Dev tooling (Node.js only, not deployed)
├── SPEC.md                 Full product and technical specification
└── package.json
```

Key architectural points:

- `src/app.js` is the main entry; it coordinates state, rendering, and UI updates
- `src/workers/reasoning-worker.js` runs model inference off the main thread
- `sw.js` caches the app shell and model files so subsequent visits are instant
- The `src/ui/` modules are decoupled from each other; each owns a DOM panel

## Deployment

This is a fully static app: no build step, no server-side logic, and no environment variables.

Serve the root directory with any static host:

```bash
# GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3, etc.
# Just point the host at the directory containing index.html.
```

The service worker (`sw.js`) caches the app shell and model locally. After the first visit, the app works offline.

## License

MIT. See `LICENSE`.

## Scripts

| Command         | Description                              |
|-----------------|------------------------------------------|
| `npm run dev`   | Start the local dev server on port 4173  |
| `npm run check` | Run a syntax check on all JS files       |

## Debugging and troubleshooting

- Append `?debug=1` to the app URL to reveal the internal debug panels and prompt traces.
- If the UI seems stale while developing, do a hard refresh or unregister the service worker in dev tools before reloading.
- Dialogue is generated by a local model, so responses can still be quirky, repetitive, or abrupt depending on browser and device performance.

## First run

On first load, the app downloads and caches a local AI model (~100MB, downloaded once). Depending on your connection, this may take a little while. The boot screen shows a progress indicator.

After the model is ready, the workspace opens automatically. You can edit the scenario and click **Generate world** at any time to rebuild the simulation.

Example prompt:

> A small fintech startup. Maya is the CTO — principled, quietly worried about technical debt. Jordan runs sales — charismatic, prone to overpromising. Priya handles compliance — meticulous, suspects Jordan is cutting corners. Sam is the intern — eager, observant, talks to everyone.
