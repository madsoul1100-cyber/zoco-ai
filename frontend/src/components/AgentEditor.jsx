import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { LANGUAGES, languageLabel } from "../lib/languages.js";
import { brainKey, mergeLlmCatalog, parseBrain, voiceGender } from "../lib/providers.js";
import { loadVoices, pickVoice, speakText, playAudio, voicesForLang, spokenForTts } from "../lib/voice.js";

export function AgentEditor({
  agent,
  onChange,
  onSubmit,
  onError,
  extra,
  actions,
  submitLabel = "Save agent",
  busy = false,
}) {
  const [catalog, setCatalog] = useState(null);
  const [bases, setBases] = useState([]);
  const [allVoices, setAllVoices] = useState([]);
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState(agent?.voice || "");
  const [previewing, setPreviewing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const voiceRef = useRef(null);

  useEffect(() => {
    api.knowledge().then(setBases).catch(() => {});
    api.providers().then(setCatalog).catch(() => {});
    loadVoices().then(setAllVoices);
  }, []);

  useEffect(() => {
    if (!agent || !catalog || agent.llmProvider) return;
    const provider = catalog.defaultLlmProvider || "openrouter";
    const model = catalog.llm?.find((item) => item.id === provider)?.models[0]?.id || "";
    onChange({
      ...agent,
      llmProvider: provider,
      llmModel: agent.llmModel || model,
      ttsProvider: agent.ttsProvider || catalog.defaultTtsProvider || "browser",
    });
  }, [agent, catalog]);

  useEffect(() => {
    if (!allVoices.length) return;
    const lang = agent?.language || "en-IN";
    const matching = voicesForLang(allVoices, lang);
    setVoices(matching);
    const chosen = pickVoice(allVoices, voiceName || agent?.voice, lang);
    if (chosen) {
      setVoiceName(chosen.name);
      voiceRef.current = chosen;
    }
  }, [agent?.language, agent?.id, allVoices]);

  useEffect(() => {
    const chosen = voices.find((voice) => voice.name === voiceName);
    if (chosen) voiceRef.current = chosen;
  }, [voiceName, voices]);

  const genderSyncRef = useRef("");
  useEffect(() => {
    if (!agent || !catalog) return;
    const lang = agent.language || "en-IN";
    if (lang === "en-IN") return;
    const g = voiceGender(catalog, agent);
    if (agent.greetingGender === g) return;
    const stamp = `${agent.id}:${agent.ttsVoice || ""}:${g}`;
    if (genderSyncRef.current === stamp) return;
    genderSyncRef.current = stamp;
    const greetings = { ...(agent.greetings || {}) };
    const source = greetings["en-IN"] || (/^[\x00-\x7F\s.,'"’-]+$/.test(agent.greeting || "") ? agent.greeting : "");
    if (!source?.trim()) {
      onChange({ ...agent, greetingGender: g });
      return;
    }
    setTranslating(true);
    api
      .translate({ text: source, from: "en-IN", to: lang, speakerGender: g })
      .then((result) => {
        onChange({
          ...agent,
          greeting: result.text,
          greetings: { ...greetings, "en-IN": source, [lang]: result.text, [`${lang}:${g}`]: result.text },
          greetingGender: g,
        });
      })
      .catch(() => onChange({ ...agent, greetingGender: g }))
      .finally(() => setTranslating(false));
  }, [agent?.id, catalog, agent?.ttsVoice, agent?.language, agent?.greetingGender]);

  if (!agent) return null;

  const llmList = mergeLlmCatalog(catalog?.llm);
  const brainProvider = agent.llmProvider || catalog?.defaultLlmProvider || "openrouter";
  const brainModels = llmList.find((item) => item.id === brainProvider)?.models || [];
  const brainModel = brainModels.some((model) => model.id === agent.llmModel)
    ? agent.llmModel
    : brainModels[0]?.id || "";
  const gender = voiceGender(catalog, agent);

  async function applySpokenGreeting(nextAgent, { language, gender: nextGender } = {}) {
    const current = nextAgent || agent;
    const lang = language || current.language || "en-IN";
    const spokenGender = nextGender || voiceGender(catalog, current);
    const greetings = { ...(current.greetings || {}) };
    if (!greetings["en-IN"] && /^[\x00-\x7F\s.,'"’-]+$/.test(current.greeting || "")) {
      greetings["en-IN"] = current.greeting;
    }
    if (lang === "en-IN") {
      onChange({
        ...current,
        language: lang,
        greeting: greetings["en-IN"] || current.greeting,
        greetings,
        greetingGender: spokenGender,
      });
      return;
    }
    const cacheKey = `${lang}:${spokenGender}`;
    if (greetings[cacheKey]) {
      onChange({ ...current, language: lang, greeting: greetings[cacheKey], greetings, greetingGender: spokenGender });
      return;
    }
    const source = greetings["en-IN"] || "";
    if (!source.trim()) {
      onChange({ ...current, language: lang, greetings, greetingGender: spokenGender });
      return;
    }
    setTranslating(true);
    onError?.("");
    try {
      const result = await api.translate({
        text: source,
        from: "en-IN",
        to: lang,
        speakerGender: spokenGender,
      });
      greetings[cacheKey] = result.text;
      greetings[lang] = result.text;
      onChange({
        ...current,
        language: lang,
        greeting: result.text,
        greetings,
        greetingGender: spokenGender,
      });
    } catch (err) {
      onChange({ ...current, language: lang, greetings, greetingGender: spokenGender });
      onError?.(err.message || "Could not translate the greeting.");
    } finally {
      setTranslating(false);
    }
  }

  async function changeLanguage(nextCode) {
    const prev = agent.language || "en-IN";
    if (nextCode === prev) return;
    const greetings = {
      ...(agent.greetings || {}),
      [prev]: agent.greeting,
    };
    if (agent.greetingGender) greetings[`${prev}:${agent.greetingGender}`] = agent.greeting;
    await applySpokenGreeting({ ...agent, greetings }, { language: nextCode, gender });
  }

  async function changeVoice(patch) {
    const next = { ...agent, ...patch };
    const nextGender = voiceGender(catalog, next);
    if ((next.language || "en-IN") !== "en-IN" && nextGender !== agent.greetingGender) {
      await applySpokenGreeting(next, { gender: nextGender });
      return;
    }
    onChange({ ...next, greetingGender: nextGender });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const payload = {
      ...agent,
      voice: voiceName,
      language: agent.language || "en-IN",
      greetings: {
        ...(agent.greetings || {}),
        [agent.language || "en-IN"]: agent.greeting,
      },
      llmProvider: agent.llmProvider,
      llmModel: agent.llmModel,
      ttsProvider: agent.ttsProvider || "browser",
      ttsVoice: agent.ttsVoice,
      ttsModel: agent.ttsModel,
      greetingGender: gender,
    };
    await onSubmit?.(payload);
  }

  return (
    <form className="card grid" onSubmit={handleSubmit}>
      {extra}
      <label>
        Name
        <input className="input" value={agent.name || ""} onChange={(e) => onChange({ ...agent, name: e.target.value })} />
      </label>
      <label>
        Direction
        <select className="input" value={agent.direction || "inbound"} onChange={(e) => onChange({ ...agent, direction: e.target.value })}>
          <option value="inbound">Inbound — answers when a customer calls</option>
          <option value="outbound">Outbound — dials customers</option>
        </select>
      </label>
      <label>
        Persona
        <textarea value={agent.persona || ""} onChange={(e) => onChange({ ...agent, persona: e.target.value })} />
      </label>
      <label>
        Greeting
        <textarea
          value={agent.greeting || ""}
          onChange={(e) => onChange({
            ...agent,
            greeting: e.target.value,
            greetings: { ...(agent.greetings || {}), [agent.language || "en-IN"]: e.target.value },
          })}
        />
      </label>
      <label>
        AI brain
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
        <span className="muted">Sarvam, Grok, OpenAI, and OpenRouter are all in this list. Keys live in Settings.</span>
      </label>
      <label>
        Spoken language
        <select
          className="input"
          value={agent.language || "en-IN"}
          disabled={translating}
          onChange={(e) => changeLanguage(e.target.value)}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {languageLabel(lang.code)}
            </option>
          ))}
        </select>
        <span className="muted">
          {translating
            ? "Translating your English greeting…"
            : "Write the greeting in English. Changing language translates it automatically. On a live call the agent follows the customer."}
        </span>
      </label>
      <label>
        Voice engine
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
      </label>
      <label>
        Spoken voice
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
          <select className="input" value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
            {voices.length === 0 ? <option value="">Loading voices…</option> : null}
            {voices.map((voice) => (
              <option key={voice.name} value={voice.name}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        )}
        <span className="muted">
          {gender === "male"
            ? "This is a male voice. Hindi will use masculine forms such as करूंगा, not करूंगी."
            : "This is a female voice. Hindi will use feminine forms such as करूंगी, not करूंगा."}
        </span>
      </label>
      <button
        className="btn ghost"
        type="button"
        disabled={previewing}
        onClick={async () => {
          const sample = spokenForTts(agent.greeting || "Hi, this is Zoco. How can I help?");
          onError?.("");
          setPreviewing(true);
          window.speechSynthesis?.cancel();
          try {
            if ((agent.ttsProvider || "browser") === "browser") {
              await speakText(sample, { voice: voiceRef.current, lang: agent.language || "en-IN" });
              return;
            }
            const clip = await api.speak({
              text: sample,
              agentId: agent.id,
              ttsProvider: agent.ttsProvider,
              ttsVoice: agent.ttsVoice,
              ttsModel: agent.ttsModel,
              language: agent.language,
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
        }}
      >
        {previewing ? "Playing selected voice…" : "Preview voice"}
      </button>
      <label>
        Success criteria
        <textarea value={agent.successCriteria || ""} onChange={(e) => onChange({ ...agent, successCriteria: e.target.value })} />
      </label>
      <label>
        Knowledge bases
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
                    const knowledgeBaseIds = checked
                      ? current.filter((id) => id !== kb.id)
                      : [...current, kb.id];
                    onChange({ ...agent, knowledgeBaseIds });
                  }}
                />
                {kb.name}
              </label>
            );
          })}
        </div>
        <span className="muted">Attach documents the agent can answer from on live calls.</span>
      </label>
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        {actions}
      </div>
    </form>
  );
}
