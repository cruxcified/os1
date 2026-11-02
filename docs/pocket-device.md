# Toward a pocket OS1

The goal: a small thing in your pocket (think XTeink X4-sized e-ink reader, or a tiny cyberdeck) that you talk to like Theodore talks to Samantha. Nothing here is built yet; this note is about keeping the software ready for it.

## The realistic shape

A device that small cannot run a model good enough to feel like OS1. Even a strong phone struggles to run a decent local model, real-time speech recognition, and a natural voice at the same time, and an e-ink reader's processor is far below a phone's. So the pocket device should be a **body**, not a **brain**:

```
pocket device (mic, speaker, button, maybe e-ink face)
      │  Wi-Fi, or Bluetooth to your phone
      ▼
OS1 server (your computer, a home server, a Raspberry Pi 5, or a small cloud VM)
      │
      ▼
Claude + speech providers
```

The server in this repo already works that way. The browser is just the first body. Anything that can:

1. capture 16 kHz mono audio and detect when you stop talking (or stream it and let the server do that later),
2. open a WebSocket, and
3. play back MP3 or WAV clips

can be another body. The protocol is in [shared/protocol.ts](../shared/protocol.ts) and is deliberately small: JSON for control messages, one binary WAV frame per utterance going up, one binary audio clip per sentence coming down.

## Candidate hardware, roughly easiest first

- **An old phone in a case** running the web app over HTTPS. Zero hardware work; good for living with OS1 day to day.
- **ESP32-S3 voice board** (for example a Seeed ReSpeaker Lite or an M5Stack CoreS3): mic array, speaker, Wi-Fi, a few dollars of power draw. Would need firmware that speaks the protocol. Voice detection could run on the server instead of the device.
- **Raspberry Pi Zero 2 W** with a mic/speaker HAT and a small e-ink display: can run a lightweight client in Python or Node, and the e-ink screen could show the OS1 mark or captions.
- **E-ink reader hardware** (X4-class): appealing form factor but usually locked down, with little audio support. Likely needs a separate audio module and custom firmware; treat it as a later project.

## Things to add when a real device exists

- Server-side voice activity detection, so a dumb device can just stream raw audio.
- Streaming speech-to-text (Deepgram's streaming API) to shave a few hundred milliseconds off each turn.
- A wake word or a hardware button, so it isn't always listening.
- Authentication on the WebSocket before exposing the server beyond your home network.
