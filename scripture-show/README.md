# Lumen Scripture Show

A modern, BibleShow-style scripture presentation app for churches — with AI that listens to the preacher, a voice that reads verses aloud, hundreds of Bible translations in dozens of languages, and **8 independent output channels** (minimum 6, configurable).

It runs as a small Node.js server. You operate it from any browser (laptop, tablet or phone), and every projector, stage monitor, livestream overlay or lobby TV is just a browser window or OBS/vMix browser source pointed at it.

## Features

| | |
|---|---|
| **Bible text** | 150+ translations in 50+ languages from the free [bolls.life](https://bolls.life) API (KJV, NIV, ESV, NKJV, NLT, RVR, NVI, LSG, Luther, Synodal, Korean, Chinese, Arabic, Hebrew, Greek …). Chapters are cached on disk so they keep working offline. Import any Bible you own from JSON (works fully offline). A small KJV sample is built in. |
| **Fast lookup** | Type `jn 3:16`, `1co13:4-7`, `Ps 23`, `Juan 3:16` — book names in the selected language work too. Word search across the translation. |
| **AI live listening** | Click the mic: speech-to-text picks up spoken references (“first Corinthians thirteen four through seven”) instantly. With an Anthropic API key, Claude also catches verses the preacher *quotes or paraphrases* without citing them. Detections queue up, or go live automatically. |
| **AI presentation builder** | Paste a sermon topic or notes → get a ready service of title slides + relevant scripture, shown in whatever translation each screen uses. |
| **Voice** | Reads verses aloud with the system’s text-to-speech voices, auto-matched to the translation’s language. Optional auto-read on go-live. |
| **8 output channels** | Each has its own layout (full screen, lower third, stage display, confidence monitor, green-screen key, transparent alpha for OBS), its own translation, a parallel second translation, theme, background image/video, text size and transition. |
| **Show control** | Preview / Live monitors, Black / Clear / Logo, ←/→ steps through verses live, service playlist, stage messages (“5 minutes left”), keyboard shortcuts. |

## Run it

```bash
cd scripture-show
npm install
npm start                       # → http://localhost:4848
# with AI:
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Or with Docker:

```bash
cd scripture-show
ANTHROPIC_API_KEY=sk-ant-... docker compose up -d
```

Settings (environment variables): `PORT` (4848), `CHANNELS` (8, min 6), `ANTHROPIC_API_KEY` (enables AI), `AI_MODEL` (`claude-opus-5-5`), `BIBLE_API` (upstream Bible source), `DATA_DIR` (cache, imports, saved show state).

## Connecting screens

- **Projector on the same computer:** Outputs tab → *Open on screen…* picks the monitor (Chrome/Edge) — double-click the window for full screen.
- **Other computers / TVs / tablets:** open `http://<server-ip>:4848/output.html?ch=N` (the server prints its LAN address on start).
- **OBS / vMix / Wirecast:** add a Browser Source with that URL at 1920×1080. Use a channel set to *Lower third · transparent* for a keyed overlay.

All outputs stay in sync through the server, so they can be on any device on the network.

## Keyboard

`/` type reference · `Enter` go live · `↑ ↓` preview verse · `← →` previous/next verse live · `B` black · `C` clear · `L` logo · `Esc` remove overlays · `PgUp/PgDn` service · `M` microphone

## Notes

- Live listening uses the browser’s speech recognition — use **Chrome or Edge** on the operator machine.
- Many modern translations are copyrighted. Make sure your church’s licence (e.g. CCLI / publisher terms) covers projecting the translations you use.
- Importing Bibles: Settings → *Import a Bible*. Accepted JSON: `{ "books": { "43": { "3": { "16": "…" } } } }`, `[{ "book": 43, "chapter": 3, "verse": 16, "text": "…" }]`, or scrollmapper-style files.

## Tests

```bash
npm test
```
