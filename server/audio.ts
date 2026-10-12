/** Decodes a 16 kHz mono PCM WAV (16-bit int or 32-bit float) into float samples. */

export function decodeWav16k(wav: Buffer): Float32Array {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a WAV file");
  }
  let offset = 12;
  let format = 1;
  let bits = 16;
  let rate = 16000;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = wav.readUInt16LE(body);
      rate = wav.readUInt32LE(body + 4);
      bits = wav.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (rate !== 16000) throw new Error(`Expected 16 kHz audio, got ${rate}`);
      const end = Math.min(body + size, wav.length);
      if (format === 3 && bits === 32) {
        return new Float32Array(wav.buffer.slice(wav.byteOffset + body, wav.byteOffset + end));
      }
      const samples = new Float32Array((end - body) >> 1);
      for (let i = 0; i < samples.length; i++) samples[i] = wav.readInt16LE(body + i * 2) / 32768;
      return samples;
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}
