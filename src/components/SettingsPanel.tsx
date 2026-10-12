import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { SettingsView } from "../../shared/protocol";

interface SettingsPanelProps {
  open: boolean;
  /** First run: no Anthropic key yet, so OS1 can't talk until one is added. */
  firstRun: boolean;
  onClose: () => void;
}

type SecretKey = keyof SettingsView["keys"];

const SECRETS: { key: SecretKey; label: string; hint: string; url: string }[] = [
  {
    key: "anthropicKey",
    label: "Anthropic",
    hint: "Required. Claude is OS1's mind.",
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

export function SettingsPanel({ open, firstRun, onClose }: SettingsPanelProps) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [secrets, setSecrets] = useState<Record<SecretKey, string>>({
    anthropicKey: "",
    deepgramKey: "",
    elevenlabsKey: "",
    openaiKey: "",
  });
  const [stt, setStt] = useState("auto");
  const [tts, setTts] = useState("auto");
  const [voice, setVoice] = useState("");
  const [userName, setUserName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => res.json() as Promise<SettingsView>)
      .then((v) => {
        if (cancelled) return;
        setView(v);
        setStt(v.stt);
        setTts(v.tts);
        setVoice(v.voice);
        setUserName(v.userName);
      })
      .catch(() => toast.error("Couldn't load settings."));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...secrets, stt, tts, voice, userName }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as SettingsView;
      setView(next);
      setSecrets({ anthropicKey: "", deepgramKey: "", elevenlabsKey: "", openaiKey: "" });
      if (!next.keys.anthropicKey) {
        toast.error("OS1 still needs an Anthropic key to talk.");
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
            OS1 needs an Anthropic API key to think. The others are optional: without them it uses
            free voices that run on this computer, which sound less natural.
          </p>
        )}

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
