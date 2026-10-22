# F8 Scripture Presenter

A modern, BibleShow-style scripture presentation app for churches — with AI that listens to the preacher, a voice that reads verses aloud, hundreds of Bible translations in dozens of languages, and **8 independent output channels** (minimum 6, configurable).

It runs as a small Node.js server. You operate it from any browser (laptop, tablet or phone), and every projector, stage monitor, livestream overlay or lobby TV is just a browser window or OBS/vMix browser source pointed at it.

## Features

| | |
|---|---|
| **Bible text** | Roughly 150 translations in dozens of languages from the free [bolls.life](https://bolls.life) API (KJV, NIV, ESV, NKJV, NLT, RVR, NVI, LSG, Luther, Synodal, Korean, Chinese, Arabic, Hebrew, Greek …). Chapters are cached on disk so they keep working offline. Import any Bible you own from JSON (works fully offline). A small KJV sample is built in. |
| **Fast lookup** | Type `jn 3:16`, `1co13:4-7`, `Ps 23`, `Juan 3:16` — book names in the selected language work too. Word search across the translation. |
| **AI live listening** | Turn on **AUTO** and click the mic: when the preacher says a scripture (“turn to first Corinthians thirteen four through seven”) it goes straight to the screens. Follow-ups work too — “verse 17”, “verses 18 to 20”, “chapter 4 verse 2”, “next verse”. With an Anthropic API key, Claude also catches verses the preacher *quotes or paraphrases* without citing them. Detections queue up, or go live automatically. |
| **Preachers in any language** | Pick the preacher’s language and listening understands it: full support (book names, spelled-out numbers, “primera de Corintios”, “versículo siguiente”) for Spanish, Portuguese, French, German, Italian and English, and chapter/verse words for Dutch, Russian, Ukrainian, Polish, Romanian, Swahili, Yoruba, Igbo, Hausa, Afrikaans, Tagalog, Indonesian, Malay, Vietnamese, Hindi, Arabic, Persian, Hebrew, Korean, Chinese and Japanese. Book names for every language are also taken from the Bibles available in it. With AI on, Claude catches quoted verses in any language. |
| **Akan (Twi, Fante), Ga, Ewe, Dagbani** | Browsers can’t hear these languages, so F8 sends each spoken phrase to **Khaya** by GhanaNLP (speech-to-text built for Ghanaian languages) through the server. The Akan pack knows Twi book names (Yohane, Nnwom, Romafo, “Korintofo nwoma a edi kan” …), Twi numbers (baako … dunsia … aduonu abiɛsa … ɔha) and handles English mixed in. |
| **Custom words** | AI · Voice → *Custom words*: add book names, numbers, “chapter”/“verse”/“to” words and “next verse” phrases for any language, test them instantly, and save them for everyone. |
| **Song lyrics** | Songs tab: one search covers your library, built-in public-domain hymns and **online lyrics** (LRCLIB, with lyrics.ovh as backup). Import a result, tidy it in the editor, save it. Sections (Verse, Chorus, Bridge…) are detected automatically, each section is split into balanced slides (choose 1–8 lines per slide), and every sung line is kept on one row at the largest size that fits the frame. CCLI song and licence numbers are shown in the credit line. |
| **Import songs from other software** | Songs → *Import*: drop files (or one .zip). Reads **EasyWorship 6/7** (`Songs.db` + `SongWords.db`), **ProPresenter 4/5/6** (`.pro4/.pro5/.pro6`) and **7** (`.pro`, `.probundle`, text only), **OpenLP** (OpenLyrics `.xml` or `songs.sqlite`) and other OpenLyrics programs, **OpenSong**, **CCLI SongSelect** (`.usr`, `.txt`), **ChordPro**, **PowerPoint/Google Slides/Keynote** (`.pptx`), **Word** (`.docx`) and plain text. You review the list first; songs already in the library are flagged and skipped. |
| **AI presentation builder** | Paste a sermon topic or notes → get a ready service of title slides + relevant scripture, shown in whatever translation each screen uses. |
| **Voice** | Reads verses aloud with the system’s text-to-speech voices, auto-matched to the translation’s language. Optional auto-read on go-live. |
| **8 output channels** | Each has its own layout (full screen, lower third, stage display, confidence monitor, green-screen key, transparent alpha for OBS), its own translation, a parallel second translation, theme, background image/video, text size and transition. |
| **Long-verse splitting** | Long verses and ranges are split into balanced screens (breaking at verse ends and punctuation). → / ← page through them; every channel stays on the same screen, even in other translations. |
| **Text styling** | Per channel: font (incl. Noto for many scripts), size, line spacing, outline, shadow, UPPERCASE, colour, alignment. Click words under the Live monitor to **highlight** them on every screen. |
| **Media & backgrounds** | Upload images and videos (drag & drop). Show them full screen (video with play/pause/restart), add them to the service, or set them as channel backgrounds. Background edits: blur, brightness, darken, colour tint, fill/fit. |
| **Phone remote** | `http://<server>:4848/remote` — big Next/Back buttons, go live by reference, Black/Clear/Logo, service list, stage messages. Optional `CONTROL_PIN`. |
| **Desktop app + NDI** | Electron app that runs everything locally, puts each channel full screen on the display you pick (remembered next time), and can send any channel as an **NDI source** (“F8 Ch N”, with transparency) to vMix, OBS, TriCaster, etc. |
| **Show control** | Preview / Live monitors, Black / Clear / Logo, ←/→ steps through screens and verses, service playlist, stage messages (“5 minutes left”), keyboard shortcuts. |

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

Settings (environment variables): `PORT` (4848), `CHANNELS` (8, min 6), `ANTHROPIC_API_KEY` (enables AI), `AI_MODEL` (`claude-opus-5-5`), `CONTROL_PIN` (require a PIN to control the show), `BIBLE_API` (upstream Bible source), `DATA_DIR` (cache, imports, media, saved show state).

### Akan / Twi and other Ghanaian languages (Khaya)

1. Get an API key from GhanaNLP’s Khaya developer portal (translation.ghananlp.org).
2. Start F8 with it: `KHAYA_API_KEY=your-key npm start` (or put it in `docker-compose.yml`).
3. In AI · Voice choose the preacher’s language *Akan · Twi* (or Fante, Ga, Ewe, Dagbani, Gurene, Kusaal, Kikuyu, Luo, Kimeru). The engine switches to Khaya automatically. Yoruba and English can also use Khaya: set *Speech engine* to Khaya.

**Check your key** with a real recording (record a phone voice memo saying e.g. “Yohane ti abiɛsa nkyekyɛm dunsia”):

```bash
npm run khaya-check -- my-recording.m4a twi
```

It prints exactly what Khaya returned and which scripture F8 would show, or a plain explanation of the error (wrong key, no speech-to-text subscription, changed address, unsupported audio format). `npm start` reads the `.env` file automatically, just like Docker.

If GhanaNLP changes its API, adjust without code changes: `KHAYA_ASR_URL` (endpoint, default `https://translation-api.ghananlp.org/asr/v1/transcribe`), `KHAYA_KEY_HEADER` (default `Ocp-Apim-Subscription-Key`), `KHAYA_LANG_PARAM` (default `language`) and `KHAYA_LANGS` (JSON map from F8 language to Khaya code). Default codes follow Khaya’s language list: Twi `twi`, Fante `fat`, Ga `gaa`, Ewe `ewe`, Dagbani `dag`, Gurene `gur`, Kusaal `kus`, Yoruba `yor`, Kikuyu `kik`, Luo `luo`, Kimeru `mer`, English `eng`.

The Twi book names and chapter/verse words were written without a native speaker’s review — check them with your team and fix anything under *Custom words*.

### Desktop app (Windows / macOS / Linux)

```bash
cd scripture-show
npm install            # also downloads Electron and the NDI SDK (NDI needs a C++ build toolchain)
npm run desktop        # run it
npm run dist:win       # build an installer (dist:mac, dist:linux too)
```

In the desktop app, *Open on screen…* lists your displays and opens that channel full screen there; assignments come back automatically next time. Turn on **NDI output** in a channel’s settings to publish it on the network. If the NDI module could not be built, the rest of the app still works and the switch tells you why.

## Connecting screens

- **Projector on the same computer:** Outputs tab → *Open on screen…* picks the monitor (Chrome/Edge) — double-click the window for full screen.
- **Other computers / TVs / tablets:** open `http://<server-ip>:4848/output.html?ch=N` (the server prints its LAN address on start).
- **OBS / vMix / Wirecast:** add a Browser Source with that URL at 1920×1080. Use a channel set to *Lower third · transparent* for a keyed overlay.

All outputs stay in sync through the server, so they can be on any device on the network.

## Keyboard

`/` type reference · `Enter` go live · `↑ ↓` preview verse · `← →` previous/next screen or verse live · `B` black · `C` clear · `L` logo · `Esc` remove overlays · `PgUp/PgDn` service · `M` microphone

## Notes

- Live listening uses the browser’s speech recognition — use **Chrome or Edge** on the operator machine.
- Online lyrics come from community databases and can contain mistakes. Most worship songs are copyrighted: projecting them needs a licence such as CCLI’s Church Copyright Licence — enter your licence number in Settings.
- Many modern translations are copyrighted. Make sure your church’s licence (e.g. CCLI / publisher terms) covers projecting the translations you use.
- Importing Bibles: Settings → *Import a Bible*. Accepted JSON: `{ "books": { "43": { "3": { "16": "…" } } } }`, `[{ "book": 43, "chapter": 3, "verse": 16, "text": "…" }]`, or scrollmapper-style files.

## Tests

```bash
npm test
```
