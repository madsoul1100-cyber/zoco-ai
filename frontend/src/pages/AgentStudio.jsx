import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { MessageTimeline, StatusBadge } from "../components/ui.jsx";
import { SettingsPanel, TestsPanel, ToolsPanel, VariablesPanel } from "../components/AgentBuilderPanels.jsx";
import { InstructionsPanel } from "../components/InstructionsPanel.jsx";
import { WorkflowPanel } from "../components/WorkflowPanel.jsx";
import { GeniePanel } from "../components/GeniePanel.jsx";
import { compileInstructions, resolveInstructionSections, splitInstructionText } from "../lib/instructionPacks.js";
import { callSettings } from "../lib/builder.js";
import { languageLabel } from "../lib/languages.js";
import { loadVoices, pickVoice, speakText, playAudio, voicesForLang, spokenForTts, isNoiseTranscript } from "../lib/voice.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RAIL = [
  { id: "instructions", label: "Instructions" },
  { id: "variables", label: "Variables" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
  { id: "tests", label: "Tests" },
  { id: "workflow", label: "Workflow" },
];

function snapshot(agent) {
  if (!agent) return "";
  const { updatedAt, createdAt, ...rest } = agent;
  return JSON.stringify(rest);
}

function RailIcon({ id }) {
  if (id === "variables") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M9 7H7.2L4 12l3.2 5H9L5.9 12 9 7zm6 0h1.8L20 12l-3.2 5H15l3.1-5L15 7z" fill="currentColor" />
      </svg>
    );
  }
  if (id === "tools") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M8.5 15.5l-3 3M14.2 6.2a3.5 3.5 0 0 1 4.3 4.3L11 18H7.5V14.5l7-8.3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (id === "settings") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 8.6A3.4 3.4 0 1 1 8.6 12 3.4 3.4 0 0 1 12 8.6z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 3.5V5.2M12 18.8v1.7M3.5 12H5.2M18.8 12h1.7M6.2 6.2l1.2 1.2M16.6 16.6l1.2 1.2M17.8 6.2l-1.2 1.2M7.4 16.6l-1.2 1.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "tests") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <rect x="6" y="4" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
        <path d="M9 9h6M9 12h6M9 15h3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "workflow") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.7" />
        <rect x="13.5" y="13.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.7" />
        <path d="M9.2 8.4 14.5 14" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M8 7h8M8 12h8M8 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function AgentStudio() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const presetCallId = searchParams.get("call");
  const launchedRef = useRef(false);
  const navigate = useNavigate();
  const [agent, setAgent] = useState(null);
  const [call, setCall] = useState(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("chat");
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState(null);
  const [allVoices, setAllVoices] = useState([]);
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");
  const [liveText, setLiveText] = useState("");
  const [heardText, setHeardText] = useState("");
  const recorder = useRef(null);
  const chunks = useRef([]);
  const callRef = useRef(null);
  const speakingRef = useRef(false);
  const recognitionRef = useRef(null);
  const sendingRef = useRef(false);
  const wantListenRef = useRef(false);
  const transcriptRef = useRef("");
  const heardRef = useRef("");
  const silenceRef = useRef(null);
  const voiceRef = useRef(null);
  const modeRef = useRef("chat");
  const agentRef = useRef(null);
  const lastSpokenRef = useRef("");
  const ignoreUntilRef = useRef(0);
  const catalogRef = useRef(null);
  const asrLoopRef = useRef(false);
  const [tab, setTab] = useState(() => {
    const requested = searchParams.get("tab");
    if (requested && RAIL.some((item) => item.id === requested)) return requested;
    return presetCallId ? "tests" : "instructions";
  });
  const [savedSnap, setSavedSnap] = useState("");
  const [genieOpen, setGenieOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bases, setBases] = useState([]);
  const [reviewNonce, setReviewNonce] = useState(0);
  const [translateTo, setTranslateTo] = useState("");
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    api.agent(id).then((next) => {
      setAgent(next);
      setSavedSnap(snapshot(next));
    }).catch((err) => setError(err.message));
    api.providers().then(setCatalog).catch(() => {});
    api.knowledge().then(setBases).catch(() => {});
    loadVoices().then((list) => {
      setAllVoices(list);
    });
    return () => {
      wantListenRef.current = false;
      stopListening();
      window.speechSynthesis?.cancel();
    };
  }, [id]);

  useEffect(() => {
    const requested = searchParams.get("tab");
    if (requested && RAIL.some((item) => item.id === requested)) setTab(requested);
  }, [searchParams]);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  useEffect(() => {
    if (!agent || !catalog || agent.llmProvider) return;
    const provider = catalog.defaultLlmProvider || "openrouter";
    const model = catalog.llm.find((item) => item.id === provider)?.models[0]?.id || "";
    setAgent((current) => ({
      ...current,
      llmProvider: provider,
      llmModel: current.llmModel || model,
      ttsProvider: current.ttsProvider || catalog.defaultTtsProvider || "browser",
    }));
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
  }, [agent?.language, allVoices]);

  useEffect(() => {
    const chosen = voices.find((voice) => voice.name === voiceName);
    if (chosen) voiceRef.current = chosen;
  }, [voiceName, voices]);

  async function saveAgent(payload) {
    setError("");
    setSaving(true);
    try {
      const next = await api.updateAgent(id, payload);
      setAgent(next);
      setSavedSnap(snapshot(next));
      return next;
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function isLive(current = callRef.current) {
    return current && ["in_progress", "ringing"].includes(current.status);
  }

  async function goLive(existing) {
    setError("");
    setLiveText("");
    setHeardText("");
    setMode("voice");
    modeRef.current = "voice";
    wantListenRef.current = false;
    stopListening();
    callRef.current = existing;
    setCall(existing);
    await startMic(existing.id);
    const connected = existing.status === "in_progress"
      ? existing
      : await api.connect(existing.id);
    callRef.current = connected;
    setCall(connected);
    const greeting =
      [...connected.messages].reverse().find((m) => m.role === "assistant")?.text || agent.greeting;
    await speak(greeting);
    await delay(700);
    if (isLive(connected)) startPersistentListen();
  }

  useEffect(() => {
    if (!agent || !presetCallId || launchedRef.current) return;
    launchedRef.current = true;
    (async () => {
      try {
        let current = await api.call(presetCallId);
        if (current.status === "queued") current = await api.startOutbound(presetCallId);
        await goLive(current);
      } catch (err) {
        setError(err.message);
        launchedRef.current = false;
      }
    })();
  }, [agent, presetCallId]);

  async function startSession(channel, firstMessage) {
    setError("");
    setLiveText("");
    setHeardText("");
    setMode(channel);
    modeRef.current = channel;
    wantListenRef.current = false;
    stopListening();
    const next = await api.startCall({
      agentId: id,
      channel,
      language: agent?.language,
      customer: { name: "Test customer", phone: "+910000000000" },
    });
    callRef.current = next;
    setCall(next);
    if (channel !== "voice") {
      setPhase("idle");
      if (firstMessage) {
        await send(firstMessage);
      }
      return;
    }
    await goLive(next);
  }

  async function send(text = draft) {
    const current = callRef.current;
    const spoken = String(text || "").trim();
    if (!current || !spoken || sendingRef.current) return;
    if (modeRef.current === "voice" && isNoiseTranscript(spoken, lastSpokenRef.current)) {
      transcriptRef.current = "";
      heardRef.current = "";
      setHeardText("");
      return;
    }
    sendingRef.current = true;
    wantListenRef.current = false;
    clearTimeout(silenceRef.current);
    stopListening();
    setDraft("");
    transcriptRef.current = "";
    heardRef.current = "";
    setHeardText("");
    setLiveText("");
    setPhase("thinking");
    try {
      if (modeRef.current === "voice") {
        const next = await api.sendMessageStream(current.id, spoken, {
          source: "voice",
          onDelta: (token) => {
            setLiveText((prev) => `${prev}${token}`.replace(/\[END:[a-z_]+\]/gi, ""));
          },
        });
        if (next) {
          callRef.current = next;
          setCall(next);
          const last = [...next.messages].reverse().find((m) => m.role === "assistant");
          setLiveText("");
          if (last?.text) await speak(last.text);
          await delay(700);
          sendingRef.current = false;
          if (isLive(next)) {
            wantListenRef.current = true;
            setPhase("listening");
            startRecognition();
          } else {
            setPhase("idle");
          }
          return;
        }
      } else {
        const next = await api.sendMessage(current.id, spoken, modeRef.current === "voice" ? "voice" : "chat");
        callRef.current = next;
        setCall(next);
        setPhase("idle");
      }
    } catch (err) {
      setError(err.message);
      setPhase("idle");
    } finally {
      sendingRef.current = false;
    }
  }

  async function mark(status, disposition, reason) {
    const current = callRef.current;
    if (!current) return;
    wantListenRef.current = false;
    stopListening();
    window.speechSynthesis?.cancel();
    const next = await api.outcome(current.id, { status, disposition, reason });
    callRef.current = next;
    setCall(next);
    setPhase("idle");
    await stopMic();
  }

  async function startMic(callId) {
    if (!navigator.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const media = new MediaRecorder(stream);
    chunks.current = [];
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    media.onstop = async () => {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      if (blob.size) {
        try {
          await api.uploadRecording(callId, blob);
        } catch {
          /* optional */
        }
      }
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.current = media;
    media.start();
  }

  async function stopMic() {
    wantListenRef.current = false;
    stopListening();
    speakingRef.current = false;
    if (recorder.current?.state === "recording") recorder.current.stop();
    window.speechSynthesis?.cancel();
  }

  async function speak(text) {
    wantListenRef.current = false;
    stopListening();
    const display = String(text || "").replace(/\[END:[a-z_]+\]/gi, "").trim();
    const clean = spokenForTts(display);
    if (!clean) return;
    lastSpokenRef.current = display;
    speakingRef.current = true;
    setPhase("speaking");
    const spokenLang = callRef.current?.language || agentRef.current?.language || "en-IN";
    const ttsProvider = agentRef.current?.ttsProvider || "browser";
    if (ttsProvider !== "browser") {
      try {
        const clip = await api.speak({
          text: display,
          agentId: agentRef.current?.id,
          ttsProvider,
          ttsVoice: agentRef.current?.ttsVoice,
          ttsModel: agentRef.current?.ttsModel,
          language: spokenLang,
          callSettings: agentRef.current?.callSettings,
        });
        if (clip?.provider === "browser" || !clip?.audioUrl) {
          throw new Error("Selected voice is not connected. Add the API key in Settings.");
        }
        await playAudio(clip.audioUrl);
      } catch (err) {
        setError(err.message || "Selected voice failed. Check Settings for the provider key.");
      }
    } else {
      await speakText(clean, {
        voice: voiceRef.current,
        lang: spokenLang,
        rate: Number(agentRef.current?.callSettings?.speakingSpeed ?? 1),
        pitch: 1 + Number(agentRef.current?.callSettings?.pitch || 0),
        cancel: true,
      });
    }
    speakingRef.current = false;
    ignoreUntilRef.current = Date.now() + 600;
  }

  function stopListening() {
    asrLoopRef.current = false;
    clearTimeout(silenceRef.current);
    try {
      recognitionRef.current?.abort();
    } catch {
      /* already stopped */
    }
    recognitionRef.current = null;
  }

  function SpeechEngine() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }

  function startPersistentListen() {
    wantListenRef.current = true;
    transcriptRef.current = "";
    startRecognition();
  }

  async function startSarvamLoop() {
    if (asrLoopRef.current) return;
    asrLoopRef.current = true;
    setPhase("listening");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      while (asrLoopRef.current && wantListenRef.current && !speakingRef.current && !sendingRef.current && isLive()) {
        const chunks = [];
        const media = new MediaRecorder(stream);
        media.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        media.start();
        await delay(3200);
        if (media.state === "recording") media.stop();
        await new Promise((resolve) => {
          media.onstop = resolve;
        });
        if (!asrLoopRef.current || speakingRef.current || sendingRef.current) break;
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size < 1800) continue;
        const { transcript } = await api.transcribe(blob, callRef.current?.language || agentRef.current?.language || "en-IN");
        const spoken = String(transcript || "").trim();
        if (spoken.length >= 2 && !isNoiseTranscript(spoken, lastSpokenRef.current)) {
          heardRef.current = spoken;
          setHeardText(spoken);
          await send(spoken);
          break;
        }
      }
    } catch (err) {
      if (wantListenRef.current) startBrowserRecognition();
      else setError(err.message);
    } finally {
      asrLoopRef.current = false;
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  function startRecognition() {
    if (catalogRef.current?.keys?.sarvam) {
      startSarvamLoop();
      return;
    }
    startBrowserRecognition();
  }

  function startBrowserRecognition() {
    const Speech = SpeechEngine();
    if (!Speech) {
      setError("Voice listening needs Chrome or Edge. You can still type.");
      return;
    }
    if (recognitionRef.current) return;
    const recognition = new Speech();
    recognition.lang = callRef.current?.language || agentRef.current?.language || "en-IN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      if (speakingRef.current || sendingRef.current) return;
      if (Date.now() < ignoreUntilRef.current) return;
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += `${piece} `;
        else interim += piece;
      }
      if (finalText) transcriptRef.current = `${transcriptRef.current} ${finalText}`.trim();
      const combined = `${transcriptRef.current} ${interim}`.trim();
      heardRef.current = combined;
      setHeardText(combined);
      clearTimeout(silenceRef.current);
      if (combined.length >= 2) {
        silenceRef.current = setTimeout(() => {
          const spoken = (transcriptRef.current || heardRef.current || "").trim();
          if (spoken.length >= 2 && !speakingRef.current && !sendingRef.current) {
            if (isNoiseTranscript(spoken, lastSpokenRef.current)) {
              transcriptRef.current = "";
              heardRef.current = "";
              setHeardText("");
              return;
            }
            send(spoken);
          }
        }, Math.max(400, (11 - Number(agentRef.current?.callSettings?.eagerness || 6)) * 180));
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        wantListenRef.current = false;
        setError("Allow microphone access for this site, then click Test voice again.");
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (wantListenRef.current && !speakingRef.current && !sendingRef.current && isLive()) {
        setTimeout(() => {
          if (wantListenRef.current && !recognitionRef.current) startRecognition();
        }, 180);
      }
    };

    try {
      recognition.start();
      setPhase("listening");
    } catch (err) {
      if (!String(err.message).includes("started")) setError(err.message);
    }
  }

  function updateGreeting(text) {
    setAgent({
      ...agent,
      greeting: text,
      greetings: { ...(agent.greetings || {}), [agent.language || "en-IN"]: text },
    });
  }

  function insertVar(key) {
    const token = `{{ ${key} }}`;
    const current = agent.greeting || "";
    const next = current && !current.endsWith(" ") ? `${current} ${token}` : `${current}${token}`;
    updateGreeting(next);
    setTab("instructions");
  }

  function applyGeniePatch(patch) {
    if (!patch || !Object.keys(patch).length) return;
    setAgent((current) => {
      const next = { ...current, ...patch };
      if (patch.greeting) {
        next.greetings = { ...(current.greetings || {}), [next.language || current.language || "en-IN"]: patch.greeting };
      }
      const blob = patch.instructions || patch.persona;
      if (blob) {
        next.instructions = blob;
        next.persona = blob;
        next.instructionSections = splitInstructionText(blob);
      }
      return next;
    });
  }

  async function finishUpdate() {
    const sections = resolveInstructionSections(agent);
    const compiled = compileInstructions(sections);
    const payload = {
      ...agent,
      voice: voiceName || agent.voice,
      version: (Number(agent.version) || 1) + 1,
      status: agent.status || "draft",
      commitVersion: true,
      instructionSections: sections,
      instructions: compiled,
      persona: compiled,
      callSettings: callSettings(agent),
      greetings: {
        ...(agent.greetings || {}),
        [agent.language || "en-IN"]: agent.greeting,
      },
    };
    await saveAgent(payload);
  }

  async function translateGreeting(code) {
    const source = agent.greetings?.["en-IN"] || agent.greeting || "";
    if (!source.trim() || !code) return;
    setTranslating(true);
    setError("");
    try {
      const result = await api.translate({
        text: source,
        from: "en-IN",
        to: code,
        speakerGender: agent.greetingGender,
      });
      setAgent({
        ...agent,
        language: code,
        greeting: result.text,
        greetings: { ...(agent.greetings || {}), "en-IN": source, [code]: result.text },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setTranslating(false);
    }
  }

  async function removeAgent() {
    if (!window.confirm(`Delete ${agent.name}? This cannot be undone.`)) return;
    await api.deleteAgent(id);
    navigate("/agents");
  }

  if (error && !agent) return <p className="error">{error}</p>;
  if (!agent) return <p className="muted builder-loading">Loading studio…</p>;

  const live = call && ["in_progress", "ringing"].includes(call.status);
  const phaseLabel = {
    idle: live ? "Mic is live — just speak" : "Voice idle",
    speaking: "Agent speaking…",
    listening: "Listening — just talk",
    thinking: "Thinking…",
  }[phase];
  const dirty = snapshot(agent) !== savedSnap;
  const versionLabel = `v${agent.version || 1} · ${agent.status || "draft"}`;

  const testsPanel = (
    <section className="live-test">
      {mode === "voice" && live ? (
        <div className="voice-stage compact">
          {phase === "speaking" || phase === "listening" ? <div className="pulse" /> : null}
          <div>
            <strong>{phaseLabel}</strong>
            <div className="muted">{languageLabel(call?.language || agent.language)}</div>
          </div>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {call ? (
        <>
          <div className="live-test-meta">
            <StatusBadge status={call.status} disposition={call.disposition} />
            <span className="muted">{languageLabel(call.language || agent.language)}</span>
          </div>
          <MessageTimeline messages={call.messages} liveText={liveText} heardText={heardText} />
          {live ? (
            <div className="composer">
              <input
                className="input"
                value={draft}
                placeholder={mode === "voice" ? "Type if the mic misses you" : "Type a reply"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <button className="btn" type="button" onClick={() => send()}>Send</button>
            </div>
          ) : (
            <p className="muted">Ended as {call.disposition?.replaceAll("_", " ") || call.status}.</p>
          )}
          {live ? (
            <button className="btn ghost" type="button" onClick={() => mark("completed", "dropped", "Ended from test")}>
              End test
            </button>
          ) : null}
        </>
      ) : (
        <div className="builder-test-empty">
          <h3>{mode === "voice" ? "Test the voice" : "Test the chat"}</h3>
          <p className="muted">
            {mode === "voice"
              ? "Allow the microphone, then talk. Chrome or Edge works best."
              : "Send a message and see how the agent replies."}
          </p>
        </div>
      )}
    </section>
  );

  return (
    <div className="builder">
      <header className="builder-top">
        <div className="builder-brand">
          <Link to="/" className="builder-logo">Zoco.ai</Link>
          <nav className="builder-links">
            <Link to="/agents">Agents</Link>
            <Link to="/workflows">Workflows</Link>
            <Link to="/phone-numbers">Phone numbers</Link>
            <Link to="/knowledge">Knowledge</Link>
            <Link to="/campaigns">Campaigns</Link>
          </nav>
        </div>
        <button className="btn" type="button" disabled={saving || !dirty} onClick={finishUpdate}>
          {saving ? "Saving…" : dirty ? "Finish update" : "Saved"}
        </button>
      </header>

      <header className="builder-head">
        <div className="builder-identity">
          <Link to="/agents" className="icon-btn" aria-label="Back to agents">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <input
            className="builder-name"
            value={agent.name || ""}
            onChange={(e) => setAgent({ ...agent, name: e.target.value })}
          />
          <span className="builder-version">{versionLabel}</span>
        </div>
        <div className="row builder-actions">
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setTab("tests");
              startSession("voice");
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M7 9v6a5 5 0 0 0 10 0V9M12 20v-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <rect x="9" y="4" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.7" />
            </svg>
            Test agent
          </button>
          <div className="menu-wrap">
            <button className="icon-btn" type="button" aria-label="More" onClick={() => setMenuOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="6" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="12" cy="18" r="1.6" />
              </svg>
            </button>
            {menuOpen ? (
              <div className="menu-pop">
                <button type="button" onClick={() => { setGenieOpen(true); setMenuOpen(false); }}>Open Genie</button>
                <button type="button" onClick={() => { setTab("tests"); startSession("chat"); setMenuOpen(false); }}>Test chat</button>
                <button type="button" className="danger" onClick={removeAgent}>Delete agent</button>
              </div>
            ) : null}
          </div>
          {genieOpen ? null : (
            <button className="icon-btn" type="button" title="Open Genie" onClick={() => setGenieOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 3l1.4 6.1L19 12l-5.6 2.9L12 21l-1.4-6.1L5 12l5.6-2.9L12 3z" fill="currentColor" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {error && agent ? <p className="error builder-banner">{error}</p> : null}

      <div className={`builder-body ${genieOpen ? "with-genie" : ""}`}>
        <nav className="builder-rail" aria-label="Agent sections">
          {RAIL.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              <RailIcon id={item.id} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="builder-main">
          {tab === "instructions" ? (
            <InstructionsPanel
              agent={agent}
              onChange={setAgent}
              onGreetingChange={updateGreeting}
              onInsertVar={insertVar}
              onReview={() => {
                setGenieOpen(true);
                setReviewNonce((n) => n + 1);
              }}
              translationsOpen={translationsOpen}
              setTranslationsOpen={setTranslationsOpen}
              translateTo={translateTo}
              setTranslateTo={setTranslateTo}
              translating={translating}
              onTranslateGreeting={translateGreeting}
            />
          ) : null}

          {tab === "variables" ? (
            <VariablesPanel agent={agent} onChange={setAgent} onInsert={insertVar} />
          ) : null}

          {tab === "tools" ? (
            <ToolsPanel agent={agent} onChange={setAgent} bases={bases} />
          ) : null}

          {tab === "settings" ? (
            <SettingsPanel
              agent={agent}
              onChange={setAgent}
              catalog={catalog}
              bases={bases}
              voices={voices}
              voiceName={voiceName}
              onVoiceName={setVoiceName}
              onError={setError}
            />
          ) : null}

          {tab === "tests" ? (
            <TestsPanel
              agent={agent}
              onChange={setAgent}
              livePanel={testsPanel}
              mode={mode}
              onStartVoice={() => startSession("voice")}
              onStartChat={(scenario) => startSession("chat", scenario)}
            />
          ) : null}

          {tab === "workflow" ? (
            <WorkflowPanel agent={agent} onChange={setAgent} />
          ) : null}
        </div>

        {genieOpen ? (
          <GeniePanel
            agent={agent}
            onApply={applyGeniePatch}
            onClose={() => setGenieOpen(false)}
            reviewNonce={reviewNonce}
          />
        ) : null}
      </div>
    </div>
  );
}
