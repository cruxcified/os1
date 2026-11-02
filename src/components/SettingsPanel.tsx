import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { LocalStatus, SettingsView } from "../../shared/protocol";
import type { SoundPrefs } from "@/hooks/useCompanion";

interface SettingsPanelProps {
  open: boolean;
  /** First run: nothing set up yet, so OS1 waits for Start. */
  firstRun: boolean;
  /** Sounds are per-device preferences: they apply immediately, no Save needed. */
  sound: SoundPrefs;
  onSoundChange: (sound: SoundPrefs) => void;
  onClose: () => void;
}

type SecretKey = keyof SettingsView["keys"];

const SECRETS: { key: SecretKey; label: string; hint: string; url: string }[] = [
  {
    key: "anthropicKey",
    label: "Anthropic",
    hint: "Optional. Claude, the deepest mind (paid per use).",
    url: "https://console.anthropic.com/settings/keys",
  },
  {
    key: "elevenlabsKey",
    label: "ElevenLabs",
    hint: "Optional. The most natural voice.",
    url: "https://elevenlabs.io/app/settings/api-keys",
  },
  {
    key: "deepgramKey",
    label: "Deepgram",
    hint: "Optional. Fast, accurate hearing.",
    url: "https://console.deepgram.com/",
  },
  {
    key: "openaiKey",
    label: "OpenAI",
    hint: "Optional. One key covers both hearing and voice.",
    url: "https://platform.openai.com/api-keys",
  },
];

const VOICE_HINTS: Record<string, string> = {
  elevenlabs: "Any ElevenLabs voice ID. Default: Brian (deep, warm).",
  openai: "onyx (default), ash, ballad, echo, sage…",
  kokoro: "am_fenrir (default), am_michael, bm_george…",
};

export function SettingsPanel({ open, firstRun, sound, onSoundChange, onClose }: SettingsPanelProps) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [secrets, setSecrets] = useState<Record<SecretKey, string>>({
    anthropicKey: "",
    deepgramKey: "",
    elevenlabsKey: "",
    openaiKey: "",
  });
  const [brain, setBrain] = useState("auto");
  const [localModel, setLocalModel] = useState("");
  const [local, setLocal] = useState<LocalStatus | null>(null);
  const [stt, setStt] = useState("auto");
  const [tts, setTts] = useState("auto");
  const [voice, setVoice] = useState("");
  const [userName, setUserName] = useState("");
  const [expressive, setExpressive] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => res.json() as Promise<SettingsView>)
      .then((v) => {
        if (cancelled) return;
        setView(v);
        setBrain(v.brain);
        setLocalModel(v.localModel);
        setStt(v.stt);
        setTts(v.tts);
        setVoice(v.voice);
        setUserName(v.userName);
        setExpressive(v.expressive);
      })
      .catch(() => toast.error("Couldn't load settings."));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const hasClaudeKey = !!view?.keys.anthropicKey || secrets.anthropicKey.trim() !== "";
  const effectiveBrain = brain === "auto" ? (hasClaudeKey ? "claude" : "local") : brain;

  // While the local brain is chosen, keep its status (and any download) fresh.
  useEffect(() => {
    if (!open || effectiveBrain !== "local") return;
    let cancelled = false;
    const poll = () =>
      fetch("/api/local/status")
        .then((res) => res.json() as Promise<LocalStatus>)
        .then((s) => !cancelled && setLocal(s))
        .catch(() => {});
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, effectiveBrain, view?.active.localModel]);

  const downloadModel = async () => {
    const res = await fetch("/api/local/pull", { method: "POST" });
    if (res.ok) setLocal((await res.json()) as LocalStatus);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...secrets,
          brain,
          localModel,
          stt,
          tts,
          voice,
          userName,
          expressive: expressive ? "on" : "off",
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as SettingsView;
      setView(next);
      setSecrets({ anthropicKey: "", deepgramKey: "", elevenlabsKey: "", openaiKey: "" });
      if (next.needsSetup) {
        toast.error("Claude needs an Anthropic key. Add one, or pick the free local mind.");
        return;
      }
      toast.success("Saved.");
      onClose();
    } catch {
      toast.error("Couldn't save settings.");
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async (key: SecretKey) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: "__clear__" }),
    });
    if (res.ok) setView((await res.json()) as SettingsView);
  };

  if (!open) return null;
  const voiceProvider = tts === "auto" ? view?.active.tts : tts;

  return (
    <div className="settings-backdrop" onClick={firstRun ? undefined : onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>{firstRun ? "Welcome to OS1" : "Settings"}</h2>
          {!firstRun && (
            <button className="settings-close" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          )}
        </div>
        {firstRun && (
          <p className="settings-intro">
            OS1 can run entirely on this computer for free: a local mind through Ollama, plus local
            hearing and a local voice. API keys are optional and make it smarter and more natural.
          </p>
        )}

        <section>
          <h3>Mind</h3>
          <label className="settings-field">
            <span className="settings-label">Think with</span>
            <select value={brain} onChange={(e) => setBrain(e.target.value)}>
              <option value="auto">Automatic (Claude if there's a key, otherwise local)</option>
              <option value="claude">Claude (needs an Anthropic key)</option>
              <option value="local">Local model (free, on this computer)</option>
            </select>
          </label>
          {effectiveBrain === "local" && (
            <>
              <label className="settings-field">
                <span className="settings-label">
                  Local model
                  <a href="https://ollama.com/library" target="_blank" rel="noreferrer">
                    browse
                  </a>
                </span>
                <input
                  value={localModel}
                  spellCheck={false}
                  placeholder={`${view?.active.localModel ?? "gemma3:12b"} (try gemma3:4b on smaller laptops)`}
                  onChange={(e) => setLocalModel(e.target.value)}
                />
              </label>
              <LocalBrainStatus status={local} onDownload={() => void downloadModel()} />
            </>
          )}
        </section>

        <section>
          <h3>API keys</h3>
          {SECRETS.map(({ key, label, hint, url }) => (
            <label key={key} className="settings-field">
              <span className="settings-label">
                {label}
                <a href={url} target="_blank" rel="noreferrer">
                  get a key
                </a>
              </span>
              <span className="settings-row">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={view?.keys[key] ? "saved (type to replace)" : hint}
                  value={secrets[key]}
                  onChange={(e) => setSecrets((s) => ({ ...s, [key]: e.target.value }))}
                />
                {view?.keys[key] && (
                  <button type="button" className="settings-clear" onClick={() => void clearKey(key)}>
                    remove
                  </button>
                )}
              </span>
            </label>
          ))}
        </section>

        <section>
          <h3>Voice</h3>
          <label className="settings-field">
            <span className="settings-label">Speaking voice</span>
            <select
              value={tts}
              onChange={(e) => {
                setTts(e.target.value);
                setVoice(""); // voice IDs belong to one provider
              }}
            >
              <option value="auto">Automatic (best available{view ? `: ${view.active.tts}` : ""})</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="openai">OpenAI</option>
              <option value="kokoro">Kokoro (free, on this computer)</option>
            </select>
          </label>
          <label className="settings-field">
            <span className="settings-label">Voice ID</span>
            <input
              value={voice}
              spellCheck={false}
              placeholder={VOICE_HINTS[voiceProvider ?? ""] ?? "Leave empty for the default deep voice"}
              onChange={(e) => setVoice(e.target.value)}
            />
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={expressive}
              disabled={voiceProvider !== "elevenlabs"}
              onChange={(e) => setExpressive(e.target.checked)}
            />
            <span>
              Expressive voice
              <small>
                {voiceProvider === "elevenlabs"
                  ? "Laughs, sighs and whispers, using ElevenLabs v4 Turbo."
                  : "Needs the ElevenLabs voice."}
              </small>
            </span>
          </label>
          <label className="settings-field">
            <span className="settings-label">Hearing</span>
            <select value={stt} onChange={(e) => setStt(e.target.value)}>
              <option value="auto">Automatic (best available{view ? `: ${view.active.stt}` : ""})</option>
              <option value="deepgram">Deepgram</option>
              <option value="openai">OpenAI</option>
              <option value="local">Whisper (free, on this computer)</option>
            </select>
          </label>
        </section>

        <section>
          <h3>Sound</h3>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={sound.chime}
              onChange={(e) => onSoundChange({ ...sound, chime: e.target.checked })}
            />
            <span>Chime when OS1 wakes up</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={sound.ambient}
              onChange={(e) => onSoundChange({ ...sound, ambient: e.target.checked })}
            />
            <span>
              Ambient sound
              <small>A soft, slow pad under the conversation. Best with headphones.</small>
            </span>
          </label>
        </section>

        <section>
          <h3>You</h3>
          <label className="settings-field">
            <span className="settings-label">What should OS1 call you?</span>
            <input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Optional" />
          </label>
        </section>

        <button className="settings-save" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : firstRun ? "Start" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Where the free local mind stands: Ollama missing, model missing, downloading, or ready. */
function LocalBrainStatus({ status, onDownload }: { status: LocalStatus | null; onDownload: () => void }) {
  if (!status) return <p className="settings-note">Checking for Ollama…</p>;
  if (!status.running) {
    return (
      <p className="settings-note">
        The local mind runs on{" "}
        <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
          Ollama
        </a>
        , a free app. Install it and open it, then come back here.
      </p>
    );
  }
  const dl = status.download;
  if (dl && !dl.error && dl.percent < 100) {
    return (
      <p className="settings-note">
        Downloading {status.model}… {dl.percent}%
      </p>
    );
  }
  if (!status.installed) {
    return (
      <p className="settings-note">
        {dl?.error ? `Download failed: ${dl.error} ` : `${status.model} isn't downloaded yet (several GB). `}
        <button type="button" className="settings-clear" onClick={onDownload}>
          {dl?.error ? "try again" : "download"}
        </button>
      </p>
    );
  }
  return <p className="settings-note">Ready: {status.model} is running on this computer.</p>;
}
