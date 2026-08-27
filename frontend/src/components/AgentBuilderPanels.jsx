import { useState } from "react";
import { api } from "../api.js";
import { Modal } from "./ui.jsx";
import { LANGUAGES, languageLabel } from "../lib/languages.js";
import { useGreetingGenderSync, withSpokenGreeting } from "../lib/greetingTranslate.js";
import { brainKey, mergeLlmCatalog, parseBrain, voiceGender } from "../lib/providers.js";
import { playAudio, speakText, spokenForTts } from "../lib/voice.js";
import {
  SYSTEM_TOOLS,
  agentTests,
  callSettings,
  customTools,
  inputVariables,
  outputVariables,
  patchSettings,
} from "../lib/builder.js";

function pronunciationMaps(pronunciations) {
  if (!pronunciations || typeof pronunciations !== "object") return {};
  if (pronunciations.pronunciations && typeof pronunciations.pronunciations === "object") {
    return pronunciations.pronunciations;
  }
  return pronunciations;
}

function pronunciationCount(pronunciations) {
  return Object.values(pronunciationMaps(pronunciations)).reduce(
    (n, map) => n + (map && typeof map === "object" ? Object.keys(map).length : 0),
    0
  );
}

function pronunciationRows(pronunciations) {
  const maps = pronunciationMaps(pronunciations);
  const rows = [];
  for (const [language, map] of Object.entries(maps)) {
    if (!map || typeof map !== "object") continue;
    for (const [word, phoneme] of Object.entries(map)) {
      rows.push({ language, word, phoneme: String(phoneme || "") });
    }
  }
  return rows.sort((a, b) => a.language.localeCompare(b.language) || a.word.localeCompare(b.word));
}

function languageDisplay(code) {
  if (code === "te-IN" || code === "Telugu") return "Telugu";
  if (code === "hi-IN" || code === "Hindi") return "Hindi";
  if (code === "en-IN" || code === "English") return "English";
  return languageLabel(code) || code;
}
function SubTabs({ value, onChange, items }) {
  return (
    <div className="subtabs">
      {items.map((item) => (
        <button key={item.id} type="button" className={value === item.id ? "on" : ""} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function RangeControl({ value, min, max, step, suffix = "", digits, onChange }) {
  const places = digits ?? (step < 1 ? 2 : 0);
  return (
    <label className="setting-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{Number(value).toFixed(places)}{suffix}</output>
    </label>
  );
}

function SettingRow({ title, hint, children, wide = false }) {
  return (
    <div className={`setting-row${wide ? " wide" : ""}`}>
      <div>
        <strong>{title}</strong>
        {hint ? <p className="muted">{hint}</p> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function VariablesPanel({ agent, onChange, onInsert }) {
  const [kind, setKind] = useState("input");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState({ key: "", defaultValue: "", dataType: "string", prompt: "" });
  const inputs = inputVariables(agent);
  const outputs = outputVariables(agent);
  const rows = (kind === "input" ? inputs : outputs).filter((row) =>
    `${row.key} ${row.defaultValue || ""} ${row.prompt || ""}`.toLowerCase().includes(search.toLowerCase())
  );

  function addRow(event) {
    event.preventDefault();
    const key = draft.key.trim().replace(/\s+/g, "_");
    if (!key) return;
    if (kind === "input") {
      if (inputs.some((row) => row.key === key)) return;
      onChange({ ...agent, inputVariables: [...inputs, { key, defaultValue: draft.defaultValue.trim() }] });
    } else {
      if (outputs.some((row) => row.key === key)) return;
      onChange({
        ...agent,
        outputVariables: [...outputs, { key, dataType: draft.dataType || "string", prompt: draft.prompt.trim() || `Extract ${key} from the call`, isGoal: outputs.length === 0 }],
      });
    }
    setDraft({ key: "", defaultValue: "", dataType: "string", prompt: "" });
  }

  return (
    <div className="builder-pane">
      <div className="info-banner">
        <div>
          <strong>Input and output variables</strong>
          <p>Input variables personalise the conversation, like greeting the caller by name. Output variables capture the summary and outcome for you to review later.</p>
        </div>
      </div>
      <div className="toolbar-row">
        <SubTabs
          value={kind}
          onChange={setKind}
          items={[{ id: "input", label: "Input variables" }, { id: "output", label: "Output variables" }]}
        />
        <input className="input search-input" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {kind === "output" ? (
        <div className="info-banner subtle">
          <div>
            <strong>When does a call count as a win?</strong>
            <p>Score every call on one output variable — “call_summary”, for instance.</p>
          </div>
        </div>
      ) : null}
      <table className="data-table">
        <thead>
          <tr>
            <th>Variable name</th>
            {kind === "input" ? <th>Default value</th> : null}
            {kind === "output" ? <th>Data type</th> : null}
            {kind === "output" ? <th>Extraction prompt</th> : null}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td><code>{row.key}</code></td>
              {kind === "input" ? (
                <td>
                  <input
                    className="input table-input"
                    value={row.defaultValue || ""}
                    onChange={(e) =>
                      onChange({
                        ...agent,
                        inputVariables: inputs.map((item) => item.key === row.key ? { ...item, defaultValue: e.target.value } : item),
                      })
                    }
                  />
                </td>
              ) : null}
              {kind === "output" ? <td>{row.dataType || "string"}</td> : null}
              {kind === "output" ? <td className="muted">{row.prompt}</td> : null}
              <td className="row-actions">
                {kind === "input" ? <button className="link-quiet" type="button" onClick={() => onInsert(row.key)}>Insert</button> : null}
                <button
                  className="link-quiet"
                  type="button"
                  onClick={() => {
                    if (kind === "input") onChange({ ...agent, inputVariables: inputs.filter((item) => item.key !== row.key) });
                    else onChange({ ...agent, outputVariables: outputs.filter((item) => item.key !== row.key) });
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="row add-row" onSubmit={addRow}>
        <input className="input" placeholder="variable_name" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
        {kind === "input" ? (
          <input className="input" placeholder="Default value" value={draft.defaultValue} onChange={(e) => setDraft({ ...draft, defaultValue: e.target.value })} />
        ) : (
          <input className="input" placeholder="Extraction prompt" value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
        )}
        <button className="btn" type="submit">Add</button>
      </form>
    </div>
  );
}

export function ToolsPanel({ agent, onChange, bases }) {
  const [kind, setKind] = useState("system");
  const [draft, setDraft] = useState({ name: "", description: "", url: "", method: "POST", bodyTemplate: "{}" });
  const custom = customTools(agent);

  function addTool(event) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    onChange({
      ...agent,
      customTools: [...custom, {
        id: `tool_${Date.now().toString(36)}`,
        name,
        description: draft.description.trim(),
        url: draft.url.trim(),
        method: draft.method || "POST",
        bodyTemplate: draft.bodyTemplate || "{}",
      }],
    });
    setDraft({ name: "", description: "", url: "", method: "POST", bodyTemplate: "{}" });
    setKind("custom");
  }

  return (
    <div className="builder-pane">
      <div className="toolbar-row">
        <SubTabs
          value={kind}
          onChange={setKind}
          items={[{ id: "custom", label: "Custom tools" }, { id: "system", label: "System tools" }]}
        />
      </div>
      {kind === "system" ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Runs</th>
              <th>Kind</th>
            </tr>
          </thead>
          <tbody>
            {SYSTEM_TOOLS.map((tool) => (
              <tr key={tool.id}>
                <td>
                  <strong>{tool.name}</strong>
                  <p className="muted">{tool.description}</p>
                </td>
                <td>{tool.runs}</td>
                <td>{tool.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : custom.length === 0 ? (
        <div className="empty-state">
          <h3>Let your agent take action</h3>
          <p className="muted">Your agent can look up the caller’s orders, verify their ID, or update a booking, and bring it right into the conversation.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Kind</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {custom.map((tool) => (
              <tr key={tool.id}>
                <td>
                  <strong>{tool.name}</strong>
                  <p className="muted">{tool.description}</p>
                  {tool.url ? <p className="muted">{tool.method || "POST"} {tool.url}</p> : <p className="muted">Add an https URL so this tool can run mid-call.</p>}
                </td>
                <td>Custom</td>
                <td>
                  <button className="link-quiet" type="button" onClick={() => onChange({ ...agent, customTools: custom.filter((item) => item.id !== tool.id) })}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {kind === "custom" ? (
        <form className="grid add-row" onSubmit={addTool}>
          <input className="input" placeholder="Tool name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="input" placeholder="What it should do on a call" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <input className="input" placeholder="https://api.example.com/lookup" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <select className="input" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })}>
            <option>POST</option>
            <option>GET</option>
            <option>PUT</option>
          </select>
          <input className="input" placeholder='{"phone":"{{phone}}"}' value={draft.bodyTemplate} onChange={(e) => setDraft({ ...draft, bodyTemplate: e.target.value })} />
          <button className="btn" type="submit">Add tool</button>
        </form>
      ) : null}
      <div className="tool-card" style={{ marginTop: 20 }}>
        <strong>Knowledge bases</strong>
        <p className="muted">Docs the agent searches when it uses Query Knowledge Base.</p>
        <div className="kb-list" style={{ marginTop: 12 }}>
          {bases.length === 0 ? <span className="muted">Create a knowledge base first.</span> : null}
          {bases.map((kb) => {
            const checked = (agent.knowledgeBaseIds || []).includes(kb.id);
            return (
              <label key={kb.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const current = agent.knowledgeBaseIds || [];
                    onChange({
                      ...agent,
                      knowledgeBaseIds: checked ? current.filter((id) => id !== kb.id) : [...current, kb.id],
                    });
                  }}
                />
                {kb.name}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({
  agent,
  onChange,
  catalog,
  bases = [],
  voices = [],
  voiceName,
  onVoiceName,
  onError,
}) {
  const settings = callSettings(agent);
  const set = (patch) => onChange(patchSettings(agent, patch));
  const allowed = settings.allowedLanguages || [];
  const [previewing, setPreviewing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [dictOpen, setDictOpen] = useState(false);
  const [dictFilter, setDictFilter] = useState("");
  const genderSyncing = useGreetingGenderSync(agent, catalog, onChange);
  const llmList = mergeLlmCatalog(catalog?.llm);
  const brainProvider = agent.llmProvider || catalog?.defaultLlmProvider || "openrouter";
  const brainModels = llmList.find((item) => item.id === brainProvider)?.models || [];
  const brainModel = brainModels.some((model) => model.id === agent.llmModel)
    ? agent.llmModel
    : brainModels[0]?.id || "";
  const gender = voiceGender(catalog, agent);
  const busyTranslate = translating || genderSyncing;
  const sarvamV3 = String(agent.ttsModel || "").includes("v3");
  const dictCount = pronunciationCount(settings.pronunciations);
  const dictRows = pronunciationRows(settings.pronunciations);
  const filteredDictRows = dictFilter.trim()
    ? dictRows.filter((row) => {
        const q = dictFilter.trim().toLowerCase();
        return (
          row.word.toLowerCase().includes(q) ||
          row.phoneme.toLowerCase().includes(q) ||
          languageDisplay(row.language).toLowerCase().includes(q)
        );
      })
    : dictRows;

  function downloadDictionary() {
    const maps = pronunciationMaps(settings.pronunciations);
    const blob = new Blob([JSON.stringify({ pronunciations: maps }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tts-dictionary.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  async function previewVoice() {
    const sample = spokenForTts(agent.greeting || "Hi, this is Zoco. How can I help?");
    onError?.("");
    setPreviewing(true);
    window.speechSynthesis?.cancel();
    try {
      if ((agent.ttsProvider || "browser") === "browser") {
        const voice = voices.find((item) => item.name === (voiceName || agent.voice));
        await speakText(sample, {
          voice,
          lang: agent.language || "en-IN",
          rate: settings.speakingSpeed,
          pitch: 1 + Number(settings.pitch || 0),
        });
        return;
      }
      const clip = await api.speak({
        text: sample,
        agentId: agent.id,
        ttsProvider: agent.ttsProvider,
        ttsVoice: agent.ttsVoice,
        ttsModel: agent.ttsModel,
        language: agent.language,
        callSettings: settings,
      });
      if (clip?.provider === "browser" || !clip?.audioUrl) {
        throw new Error("This voice needs a Sarvam or OpenAI key in Settings.");
      }
      await playAudio(clip.audioUrl);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setPreviewing(false);
    }
  }

  async function changeLanguage(nextCode) {
    const prev = agent.language || "en-IN";
    if (nextCode === prev) return;
    setTranslating(true);
    onError?.("");
    const greetings = {
      ...(agent.greetings || {}),
      [prev]: agent.greeting,
    };
    if (agent.greetingGender) greetings[`${prev}:${agent.greetingGender}`] = agent.greeting;
    const { agent: next, error } = await withSpokenGreeting({ ...agent, greetings }, catalog, {
      language: nextCode,
      gender,
    });
    onChange(next);
    if (error) onError?.(error.message || "Could not translate the greeting.");
    setTranslating(false);
  }

  async function changeVoice(patch) {
    const next = { ...agent, ...patch };
    const nextGender = voiceGender(catalog, next);
    if ((next.language || "en-IN") !== "en-IN" && nextGender !== agent.greetingGender) {
      setTranslating(true);
      const { agent: spoken, error } = await withSpokenGreeting(next, catalog, { gender: nextGender });
      onChange(spoken);
      if (error) onError?.(error.message || "Could not translate the greeting.");
      setTranslating(false);
      return;
    }
    onChange({ ...next, greetingGender: nextGender });
  }

  return (
    <div className="builder-pane">
      <h2>Settings</h2>
      <div className="settings-stack">
        <h3>Agent</h3>
        <SettingRow title="Direction" hint="Inbound answers when someone calls; outbound dials them">
          <select className="input" value={agent.direction || "inbound"} onChange={(e) => onChange({ ...agent, direction: e.target.value })}>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
        </SettingRow>
        <SettingRow title="Success criteria" hint="When this call should be marked successful">
          <textarea className="setting-textarea" value={agent.successCriteria || ""} onChange={(e) => onChange({ ...agent, successCriteria: e.target.value })} />
        </SettingRow>

        <h3>Speaking</h3>
        <SettingRow title="Voice engine" hint="Browser is free. Sarvam and OpenAI need a key in Settings.">
          <select
            className="input"
            value={agent.ttsProvider || "browser"}
            onChange={(e) => {
              const ttsProvider = e.target.value;
              const spec = catalog?.tts?.find((item) => item.id === ttsProvider);
              const first = spec?.voices?.[0];
              changeVoice({
                ttsProvider,
                ttsVoice: first?.id || "",
                ttsModel: first?.model || spec?.model || "",
              });
            }}
          >
            {(catalog?.tts || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}{item.ready ? "" : " — add key"}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          title="Spoken voice"
          hint={gender === "male"
            ? "Male voice. Hindi uses masculine forms such as करूंगा."
            : "Female voice. Hindi uses feminine forms such as करूंगी."}
        >
          <div className="setting-voice">
            {agent.ttsProvider && agent.ttsProvider !== "browser" ? (
              <select
                className="input"
                value={agent.ttsVoice || ""}
                onChange={(e) => {
                  const ttsVoice = e.target.value;
                  const spec = catalog?.tts?.find((item) => item.id === agent.ttsProvider);
                  const voice = spec?.voices?.find((item) => item.id === ttsVoice);
                  changeVoice({ ttsVoice, ttsModel: voice?.model || spec?.model || agent.ttsModel || "" });
                }}
              >
                {(catalog?.tts?.find((item) => item.id === agent.ttsProvider)?.voices || []).map((voice) => (
                  <option key={voice.id} value={voice.id}>{voice.label}</option>
                ))}
              </select>
            ) : (
              <select
                className="input"
                value={voiceName || ""}
                onChange={(e) => {
                  onVoiceName?.(e.target.value);
                  onChange({ ...agent, voice: e.target.value });
                }}
              >
                {voices.length === 0 ? <option value="">Loading voices…</option> : null}
                {voices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>
            )}
            <button className="btn ghost" type="button" disabled={previewing} onClick={previewVoice}>
              {previewing ? "Playing…" : "Preview voice"}
            </button>
          </div>
        </SettingRow>
        <SettingRow title="Speaking speed" hint="~0.95–1.0 sounds most natural. Speeds above 1.15 are softened for Sarvam.">
          <RangeControl min={0.5} max={2} step={0.05} suffix="x" value={settings.speakingSpeed} onChange={(speakingSpeed) => set({ speakingSpeed })} />
        </SettingRow>
        <SettingRow
          title="Voice expressiveness"
          hint={
            sarvamV3
              ? "Keep ~0.5–0.6 so every sentence sounds like the same person. Higher values change tone between clips."
              : "Applies when using Sarvam Bulbul v3."
          }
        >
          <RangeControl
            min={0.2}
            max={0.85}
            step={0.05}
            value={settings.ttsTemperature ?? 0.55}
            onChange={(ttsTemperature) => set({ ttsTemperature })}
          />
        </SettingRow>
        <SettingRow
          title="Pitch"
          hint={sarvamV3
            ? "Sarvam Bulbul v3 ignores pitch. It still applies to browser voice and Bulbul v2."
            : "Higher is sharper, lower is deeper."}
        >
          <RangeControl min={-0.75} max={0.75} step={0.05} value={settings.pitch} onChange={(pitch) => set({ pitch })} />
        </SettingRow>
        <SettingRow title="Pronunciation dictionary" hint="Custom word pronunciations applied before TTS (and uploaded to Sarvam bulbul:v3 when connected)" wide>
          <div className="dict-row">
            {dictCount ? (
              <button type="button" className="btn ghost" onClick={() => setDictOpen(true)}>
                {dictCount} entries
              </button>
            ) : (
              <span className="muted">No dictionary</span>
            )}
            <label className="btn ghost">
              {dictCount ? "Replace dictionary" : "Upload JSON"}
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    const raw = JSON.parse(await file.text());
                    const pronunciations = raw?.pronunciations || raw;
                    set({ pronunciations, sarvamDictId: "" });
                    setDictOpen(true);
                  } catch {
                    window.alert("Could not read that pronunciation dictionary JSON.");
                  }
                }}
              />
            </label>
            {dictCount ? (
              <>
                <button type="button" className="btn ghost" onClick={downloadDictionary}>
                  Download
                </button>
                <button type="button" className="btn ghost" onClick={() => set({ pronunciations: null, sarvamDictId: "" })}>
                  Delete dictionary
                </button>
              </>
            ) : null}
          </div>
        </SettingRow>

        <Modal
          open={dictOpen}
          title="Pronunciation dictionary"
          onClose={() => setDictOpen(false)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={downloadDictionary}>Download JSON</button>
              <button type="button" className="btn" onClick={() => setDictOpen(false)}>Close</button>
            </>
          }
        >
          <p className="muted dict-meta">{dictCount} custom pronunciations loaded</p>
          <input
            className="input"
            placeholder="Search word, phoneme, or language…"
            value={dictFilter}
            onChange={(e) => setDictFilter(e.target.value)}
          />
          <div className="dict-table-wrap">
            <table className="dict-table">
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Phoneme</th>
                  <th>Language</th>
                </tr>
              </thead>
              <tbody>
                {filteredDictRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">No matching entries</td>
                  </tr>
                ) : (
                  filteredDictRows.map((row) => (
                    <tr key={`${row.language}::${row.word}`}>
                      <td>{row.word}</td>
                      <td>/{row.phoneme}/</td>
                      <td>{languageDisplay(row.language)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Modal>

        <h3>Thinking & knowledge</h3>
        <SettingRow title="AI brain" hint="Sarvam, Grok, OpenAI, and OpenRouter. Keys live in Settings.">
          <select
            className="input"
            value={brainKey(brainProvider, brainModel)}
            onChange={(e) => onChange({ ...agent, ...parseBrain(e.target.value) })}
          >
            {llmList.map((item) => (
              <optgroup key={item.id} label={`${item.label}${item.ready === false ? " — add key in Settings" : ""}`}>
                {item.models.map((model) => (
                  <option key={`${item.id}::${model.id}`} value={brainKey(item.id, model.id)}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </SettingRow>
        <SettingRow title="Warm transfer number" hint="Used by Transfer to human on live Twilio calls">
          <input className="input" value={agent.transferNumber || ""} onChange={(e) => onChange({ ...agent, transferNumber: e.target.value })} placeholder="+91…" />
        </SettingRow>
        <SettingRow title="Model temperature" hint="Lower stays compliant and consistent; higher is more creative">
          <RangeControl min={0} max={1} step={0.05} value={settings.temperature} onChange={(temperature) => set({ temperature })} />
        </SettingRow>
        <SettingRow title="Knowledge bases" hint="Docs Query Knowledge Base can search on the call" wide>
          <div className="kb-list">
            {bases.length === 0 ? <span className="muted">Create a knowledge base first.</span> : null}
            {bases.map((kb) => {
              const checked = (agent.knowledgeBaseIds || []).includes(kb.id);
              return (
                <label key={kb.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const current = agent.knowledgeBaseIds || [];
                      onChange({
                        ...agent,
                        knowledgeBaseIds: checked ? current.filter((id) => id !== kb.id) : [...current, kb.id],
                      });
                    }}
                  />
                  {kb.name}
                </label>
              );
            })}
          </div>
        </SettingRow>

        <h3>Listening</h3>
        <SettingRow title="Let callers interrupt" hint="Caller can talk over the agent while it’s speaking">
          <label className="switch">
            <input type="checkbox" checked={settings.allowInterrupt} onChange={(e) => set({ allowInterrupt: e.target.checked })} />
            <span />
          </label>
        </SettingRow>
        <SettingRow title="Eagerness to respond" hint="How quickly the agent replies after a pause. Lower waits less.">
          <RangeControl min={1} max={10} step={1} value={settings.eagerness} onChange={(eagerness) => set({ eagerness })} />
        </SettingRow>
        <SettingRow title="Volume threshold" hint="Quieter audio below this level counts as silence. Lower includes more noise.">
          <RangeControl
            min={-70}
            max={-20}
            step={1}
            suffix=" dB"
            digits={0}
            value={settings.volumeThresholdDb ?? -50}
            onChange={(volumeThresholdDb) => set({ volumeThresholdDb })}
          />
        </SettingRow>

        <h3>Environment</h3>
        <SettingRow title="Background sound" hint="Ambient noise behind the agent on voice tests and live Twilio TTS">
          <select
            className="input"
            value={settings.backgroundSound || "off"}
            onChange={(e) => set({ backgroundSound: e.target.value })}
          >
            <option value="off">None</option>
            <option value="quiet_office">Quiet office</option>
          </select>
        </SettingRow>
        {settings.backgroundSound === "quiet_office" ? (
          <SettingRow title="Background volume" hint="How loud the ambient noise plays under speech">
            <RangeControl
              min={0.02}
              max={0.35}
              step={0.01}
              value={settings.backgroundVolume ?? 0.12}
              onChange={(backgroundVolume) => set({ backgroundVolume })}
            />
          </SettingRow>
        ) : null}

        <h3>Language personalisation</h3>
        <SettingRow title="Spoken language" hint={busyTranslate ? "Translating your English greeting…" : "Write the greeting in English. Changing language translates it. On a live call the agent can still follow the caller."}>
          <select className="input" value={agent.language || "en-IN"} disabled={busyTranslate} onChange={(e) => changeLanguage(e.target.value)}>
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>{languageLabel(lang.code)}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow title="Switch language during call" hint="Follow along when the caller switches languages">
          <label className="switch">
            <input type="checkbox" checked={settings.switchLanguage} onChange={(e) => set({ switchLanguage: e.target.checked })} />
            <span />
          </label>
        </SettingRow>
        <SettingRow title="Languages allowed" hint="Languages the agent can understand and reply in">
          <div className="chip-select">
            {LANGUAGES.map((lang) => {
              const on = allowed.includes(lang.code);
              return (
                <button
                  key={lang.code}
                  type="button"
                  className={on ? "chip on" : "chip"}
                  onClick={() =>
                    set({
                      allowedLanguages: on
                        ? allowed.filter((code) => code !== lang.code)
                        : [...allowed, lang.code],
                    })
                  }
                >
                  {lang.native}
                </button>
              );
            })}
          </div>
        </SettingRow>
        <SettingRow title="Auto-detected language switch" hint="Match the caller’s language using the allowed set above.">
          <label className="switch">
            <input type="checkbox" checked={settings.autoDetectLanguage} onChange={(e) => set({ autoDetectLanguage: e.target.checked })} />
            <span />
          </label>
        </SettingRow>
        <SettingRow title="Output numbers in Indic" hint="Converts numbers to Indic format. E.g. '500' → 'paanch sau'">
          <label className="switch">
            <input type="checkbox" checked={settings.indicNumbers} onChange={(e) => set({ indicNumbers: e.target.checked })} />
            <span />
          </label>
        </SettingRow>

        <h3>In call actions</h3>
        <SettingRow title="Nudge quiet callers" hint="Speak up if the caller goes silent for a while">
          <label className="switch">
            <input type="checkbox" checked={settings.nudgeEnabled} onChange={(e) => set({ nudgeEnabled: e.target.checked })} />
            <span />
          </label>
        </SettingRow>
        {settings.nudgeEnabled
          ? (settings.nudges || []).map((nudge, index) => (
            <SettingRow key={nudge.id || index} title={`Message ${index + 1}`} hint="Spoken if the caller stays quiet" wide>
              <div className="nudge-edit">
                <input
                  className="input"
                  value={nudge.message}
                  onChange={(e) =>
                    set({
                      nudges: settings.nudges.map((item, i) => (i === index ? { ...item, message: e.target.value } : item)),
                    })
                  }
                />
                <input
                  className="input table-input"
                  type="number"
                  min="3"
                  value={nudge.afterSeconds}
                  onChange={(e) =>
                    set({
                      nudges: settings.nudges.map((item, i) => (i === index ? { ...item, afterSeconds: Number(e.target.value) } : item)),
                    })
                  }
                />
                <span className="muted">sec</span>
                {(settings.nudges || []).length > 1 ? (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => set({ nudges: settings.nudges.filter((_, i) => i !== index) })}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </SettingRow>
          ))
          : null}
        {settings.nudgeEnabled ? (
          <SettingRow title="Add nudge" hint="Extra message if the caller stays quiet">
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                set({
                  nudges: [
                    ...(settings.nudges || []),
                    { id: `nudge_${Date.now().toString(36)}`, message: "Hello?", afterSeconds: 10 },
                  ],
                })
              }
            >
              Add More
            </button>
          </SettingRow>
        ) : null}
        <SettingRow title="Hang up after unanswered nudges" hint="End the call if the caller still doesn’t respond">
          <label className="switch">
            <input type="checkbox" checked={settings.hangupAfterNudges} onChange={(e) => set({ hangupAfterNudges: e.target.checked })} />
            <span />
          </label>
        </SettingRow>
        <SettingRow title="Voicemail" hint="Leave a message when voicemail is detected">
          <label className="switch">
            <input type="checkbox" checked={settings.voicemailEnabled} onChange={(e) => set({ voicemailEnabled: e.target.checked })} />
            <span />
          </label>
        </SettingRow>
        {settings.voicemailEnabled ? (
          <SettingRow title="Voicemail message" hint="What the agent says on voicemail" wide>
            <textarea value={settings.voicemailMessage} onChange={(e) => set({ voicemailMessage: e.target.value })} />
          </SettingRow>
        ) : null}
        <SettingRow title="Max call length" hint="Ends the call after this many minutes (up to 60)">
          <input className="input table-input" type="number" min="1" max="60" value={settings.maxCallMinutes} onChange={(e) => set({ maxCallMinutes: Number(e.target.value) })} />
        </SettingRow>
      </div>
    </div>
  );
}

export function TestsPanel({ agent, onChange, livePanel, onStartVoice, onStartChat, mode = "chat" }) {
  const tests = agentTests(agent);
  const [modal, setModal] = useState(null);
  const [draft, setDraft] = useState({ name: "", scenario: "", behaviors: [""] });
  const [scenariosOpen, setScenariosOpen] = useState(false);

  function createTest(event) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.scenario.trim()) return;
    onChange({
      ...agent,
      tests: [
        ...tests,
        {
          id: `test_${Date.now().toString(36)}`,
          name: draft.name.trim(),
          scenario: draft.scenario.trim(),
          behaviors: draft.behaviors.map((item) => item.trim()).filter(Boolean),
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setModal(null);
    setDraft({ name: "", scenario: "", behaviors: [""] });
  }

  return (
    <div className="builder-pane test-studio">
      <div className="test-live-head">
        <h2>Test</h2>
        <div className="subtabs">
          <button type="button" className={mode === "voice" ? "on" : ""} onClick={onStartVoice}>Voice</button>
          <button type="button" className={mode !== "voice" ? "on" : ""} onClick={() => onStartChat()}>Chat</button>
        </div>
      </div>

      {livePanel}

      <div className="test-scenarios">
        <button className="link-quiet" type="button" onClick={() => setScenariosOpen((open) => !open)}>
          {scenariosOpen ? "Hide scenarios" : "Saved scenarios"}
        </button>
        {scenariosOpen ? (
          <>
            <div className="toolbar-row" style={{ marginTop: 12 }}>
              <p className="muted" style={{ margin: 0 }}>Optional scripts you can run against this agent.</p>
              <button className="btn ghost" type="button" onClick={() => setModal("pick")}>+ New</button>
            </div>
            {tests.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>User scenario</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tests.map((test) => (
                    <tr key={test.id}>
                      <td><strong>{test.name}</strong></td>
                      <td className="muted">{test.scenario}</td>
                      <td className="row-actions">
                        <button className="btn ghost" type="button" onClick={() => onStartChat(test.scenario)}>Run</button>
                        <button className="link-quiet" type="button" onClick={() => onChange({ ...agent, tests: tests.filter((item) => item.id !== test.id) })}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No saved scenarios yet.</p>
            )}
          </>
        ) : null}
      </div>

      {modal ? (
        <div className="modal-back" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="builder-section-head">
              <h3>New test</h3>
              <button className="icon-btn" type="button" onClick={() => setModal(null)}>×</button>
            </div>
            {modal === "pick" ? (
              <div className="pick-grid">
                <button type="button" className="pick-card" onClick={() => setModal("single")}>
                  <strong>Single test case</strong>
                  <p className="muted">Describe a flow — AI fills in the test details for you.</p>
                </button>
                <button
                  type="button"
                  className="pick-card"
                  onClick={() => {
                    const suite = [
                      { name: "Caller is busy", scenario: "The caller says this is not a good time and asks to be called later.", behaviors: ["Offer a callback", "Do not push"] },
                      { name: "Caller wants to continue", scenario: "The caller says yes, they can talk now, and answers the first question.", behaviors: ["Continue the script", "Stay in the agent's language"] },
                    ].map((item) => ({ ...item, id: `test_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() }));
                    onChange({ ...agent, tests: [...tests, ...suite] });
                    setModal(null);
                  }}
                >
                  <strong>Set of test cases</strong>
                  <p className="muted">Generate a starter suite from this agent’s greeting and goal.</p>
                </button>
              </div>
            ) : (
              <form className="test-form" onSubmit={createTest}>
                <label>
                  Name
                  <input className="input" placeholder="e.g. Handles a busy caller" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label>
                  User scenario
                  <textarea placeholder="Describe what the user will say or do…" value={draft.scenario} onChange={(e) => setDraft({ ...draft, scenario: e.target.value })} />
                </label>
                <div>
                  <div className="builder-section-head">
                    <strong>Expected behaviors</strong>
                    <button className="link-quiet" type="button" onClick={() => setDraft({ ...draft, behaviors: [...draft.behaviors, ""] })}>+ Add</button>
                  </div>
                  {draft.behaviors.map((item, index) => (
                    <textarea
                      key={index}
                      placeholder="What the agent should do…"
                      value={item}
                      onChange={(e) => setDraft({ ...draft, behaviors: draft.behaviors.map((row, i) => (i === index ? e.target.value : row)) })}
                    />
                  ))}
                </div>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn ghost" type="button" onClick={() => setModal("pick")}>Back</button>
                  <button className="btn" type="submit">Create test</button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
