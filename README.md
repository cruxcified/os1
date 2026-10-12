# OS1

A personal take on OS1 from *Her*: a voice companion you just talk to. It listens hands-free, answers in a deep, warm voice within about a second, lets you interrupt it mid-sentence, and remembers you between conversations.

Originally forked from [callbacked/os1](https://github.com/callbacked/os1), which ran a 1B model entirely in the browser. This version trades "fully local" for "actually feels like talking to someone": Claude is the brain, and speech runs through fast streaming providers (with free local fallbacks).

## How a conversation flows

```
 mic ──► voice activity detection (in the browser, Silero VAD)
           │  you stop talking for ~0.7s
           ▼
       WAV utterance ──► server ──► speech-to-text (Deepgram / OpenAI / local Whisper)
                                      │
                                      ▼
                         Claude, streaming, with persona + memories
                                      │  each sentence as soon as it's written
                                      ▼
                         text-to-speech (ElevenLabs / OpenAI / local Kokoro)
                                      │
 speaker ◄── gapless playback ◄───────┘
```

What makes it feel natural:

- **Hands-free turn-taking.** No push-to-talk. A small voice-activity model decides when you've finished a thought.
- **Sentence streaming.** Speech starts on the first sentence while Claude is still writing the rest.
- **Barge-in.** Start talking while it's speaking and it stops, remembers it was cut off, and follows you.
- **"I wasn't done."** If you keep talking before it answers, both halves are treated as one message.
- **Memory and persona continuity.** After each exchange a small, fast model writes down anything worth remembering about you, and about itself (like the name it picks for itself). These go into every conversation. The last stretch of conversation is kept verbatim too, so it picks up where you left off.
- **Time awareness.** It knows the time of day and how long it's been since you last talked.

## Getting started

OS1 is a desktop app for Mac and Windows. It has its own window and a menu bar (or tray) icon, and it keeps running when you close the window. Everything runs on your computer except the calls to Claude and the voice services.

Requires Node 22+ to build.

```bash
npm install
npm run desktop        # run the app from source
```

On first launch it asks for your API keys (only Anthropic is required), then wakes up and says hello. macOS will ask for microphone access. Headphones help: with speakers, its own voice can occasionally be mistaken for you interrupting.

### Building an installable app

Build on the OS you're targeting:

```bash
npm run dist:mac       # on a Mac: release/OS1-<version>.dmg
npm run dist:win       # on Windows: release/OS1 Setup <version>.exe
```

The builds aren't code-signed, so the first launch needs a nudge: on macOS, right-click OS1 in Applications and choose Open; on Windows, choose "More info" then "Run anyway" on the SmartScreen prompt.

Your keys, memories and conversation live in the app's data folder (open it from the tray menu or Help > Open Data Folder): `~/Library/Application Support/OS1` on macOS, `%APPDATA%\OS1` on Windows.

### Running in a browser instead

```bash
cp .env.example .env     # add your keys, or set them later in Settings
npm run dev
```

Then open http://localhost:5173 and tap the screen to begin.

### Keys and defaults

| Part | Default | Key | Free fallback |
| --- | --- | --- | --- |
| Brain | Claude Opus 5.5 at low effort | `ANTHROPIC_API_KEY` (required) | none |
| Ears | Deepgram Nova-3 | `DEEPGRAM_API_KEY` | OpenAI if that key is set, otherwise Whisper on your CPU |
| Voice | ElevenLabs "Brian" (deep, resonant) on Flash v2.5 | `ELEVENLABS_API_KEY` | OpenAI "onyx" if that key is set, otherwise Kokoro "am_fenrir" on your CPU |

The cheapest good setup is Anthropic plus OpenAI (one key covers ears and voice). The most natural one is Anthropic plus Deepgram plus ElevenLabs. Every voice default is a deeper male voice; change it with `OS1_VOICE` (any ElevenLabs voice ID, an OpenAI voice name, or a Kokoro voice like `am_michael` or `bm_george`).

For snappier, cheaper replies set `OS1_MODEL=claude-haiku-5-5`. For deeper conversations, raise `OS1_EFFORT` to `medium`. Keys, voices and your name can be changed in the app's Settings (the gear icon). Advanced options are in [.env.example](.env.example).

### Personality

The persona lives in [server/persona.md](server/persona.md). It's plain prose, so edit it freely: how it talks, how long its replies are, what it cares about. It starts without a name and, like Samantha, can choose one. To change it in the installed app, put your own `persona.md` in the data folder; it's re-read on every turn, so edits apply immediately.

### Memory

Everything is stored as readable JSON in the data folder (`data/` when running from source, git-ignored):

- `memory.json`: facts it has learned, about you and about itself. You can also browse and delete these from the brain icon in the app.
- `history.json`: the recent conversation.
- `settings.json`: what you entered in Settings, including API keys (readable only by your user account).

Delete the folder to start fresh.

## Project layout

```
desktop/main.ts    the desktop app: window, tray, mic permission; runs the server in-process
server/            Node server: one process serves the app and the voice socket
  index.ts         HTTP + WebSocket server (embeds Vite in dev)
  session.ts       the turn loop: transcribe, think, speak, barge-in
  brain.ts         Claude streaming + prompt assembly
  persona.md       who OS1 is
  memory.ts        long-term memory + reflection
  stt/, tts/       speech providers
  text.ts          sentence chunking for streaming speech
shared/protocol.ts the message protocol between a "body" and the server
src/               React client: OS1 animation, VAD, playback, captions, memory viewer
docs/              notes on running from a pocket device
```

## Scripts

- `npm run desktop` runs the desktop app from source; `npm run dist:mac` / `npm run dist:win` build installers.
- `npm run dev` runs everything in a browser with hot reload on one port.
- `npm run build && npm start` runs the production build.
- `npm test` runs the unit tests; `npm run typecheck` and `npm run lint` check the code.

## Using it from your phone or another device

The microphone only works on `localhost` or over HTTPS. To talk to OS1 from a phone, run the server on your computer and expose it over HTTPS, for example with [Tailscale Serve](https://tailscale.com/kb/1312/serve) (`tailscale serve 5173`), then open that URL on the phone. See [docs/pocket-device.md](docs/pocket-device.md) for where this is headed.

## Acknowledgements

- **callbacked** for the original OS1 project this grew out of.
- **Siyoung Park** for the MIT-licensed OS1 loading animation concept [on CodePen](https://codepen.io/psyonline/pen/yayYWg).
- **ricky0123/vad** for in-browser Silero voice activity detection, and **Xenova** and the **ONNX Community** for Transformers.js, Kokoro and Whisper ports.
- **Spike Jonze** and everyone who made *Her*.
