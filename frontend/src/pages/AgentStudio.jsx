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
import { loadVoices, pickVoice, speakText, playAudio, playStreamingTts, stopAudio, stopAmbient, voicesForLang, spokenForTts, isNoiseTranscript, isLikelyAgentEcho, isMeaningfulBargeIn, isUrgentUserCommand, isLanguageSwitchCommand, stripModelControlText, normalizeVoiceTranscript, createSpeechQueue, pullSpeakable } from "../lib/voice.js";
import { startStreamingStt } from "../lib/sttStream.js";

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
  const [pendingUserText, setPendingUserText] = useState("");
  const recorder = useRef(null);
  const chunks = useRef([]);
  const micStreamRef = useRef(null);
  const recordingDoneRef = useRef(null);
  const recordingAudioContextRef = useRef(null);
  const recordingDestinationRef = useRef(null);
  const recordingMicSourceRef = useRef(null);
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
  const asrGenerationRef = useRef(0);
  const nudgeIndexRef = useRef(0);
  const nudgeTimerRef = useRef(null);
  const quietSinceRef = useRef(0);
  const speechQueueRef = useRef(null);
  const speakAbortRef = useRef(false);
  const bargeWatchRef = useRef(null);
  const greetingProtectRef = useRef(false);
  const userBargeOpenRef = useRef(false);
  const lastSentUserRef = useRef({ text: "", at: 0 });
  const ttsPrepRef = useRef(new Map());
  const streamSttRef = useRef(null);
  const pendingUserRef = useRef("");
  const streamAbortCtrlRef = useRef(null);
  const coalesceTimerRef = useRef(null);
  const coalesceExtendRef = useRef(0);
  const lastVoiceActivityRef = useRef(0);
  const bargeCandidateRef = useRef({ text: "", since: 0, updates: 0 });
  const acceptedBargeTextRef = useRef("");
  const sttLanguageHintRef = useRef("");
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
      const activeCall = callRef.current;
      const finalizeAbandonedVoice = modeRef.current === "voice"
        && activeCall
        && isLive(activeCall);
      wantListenRef.current = false;
      speakAbortRef.current = true;
      speechQueueRef.current?.clear();
      void (async () => {
        await stopMic();
        if (finalizeAbandonedVoice) {
          await api.outcome(activeCall.id, {
            status: "completed",
            disposition: "dropped",
            reason: "Voice test closed before an explicit outcome",
          }).catch(() => {});
        }
      })();
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
      ttsProvider: current.ttsProvider || (catalog.keys?.sarvam ? "sarvam" : catalog.defaultTtsProvider) || "browser",
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
    nudgeIndexRef.current = 0;
    clearNudgeTimer();
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
    // Seed echo filter with full greeting so speaker bleed is ignored, but allow barge-in.
    lastSpokenRef.current = String(greeting || "").trim();
    greetingProtectRef.current = false;
    wantListenRef.current = true;
    startPersistentListen();
    // Short settle so STT is live before TTS starts — greeting is interruptible.
    ignoreUntilRef.current = Date.now() + 250;
    await speak(greeting);
    if (!userBargeOpenRef.current) {
      ignoreUntilRef.current = Date.now() + 500;
    }
    if (isLive(connected) && !pendingUserRef.current && !sendingRef.current) {
      setPhase("listening");
      scheduleNudge();
    }
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
    setPendingUserText("");
    setMode(channel);
    modeRef.current = channel;
    wantListenRef.current = false;
    stopListening();
    const defaults = Object.fromEntries(
      (agent?.inputVariables || []).filter((item) => item?.key).map((item) => [item.key, item.defaultValue || ""])
    );
    const next = await api.startCall({
      agentId: id,
      channel,
      language: agent?.language,
      customer: {
        name: defaults.customer_name || defaults.caller_name || "Ravi",
        phone: "+910000000000",
        ...defaults,
      },
      variables: {
        ...defaults,
        customer_name: defaults.customer_name || defaults.caller_name || "Ravi",
      },
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

  function interruptSpeaking() {
    if (!speakingRef.current && !speechQueueRef.current?.busy) return false;
    speakAbortRef.current = true;
    greetingProtectRef.current = false;
    try {
      streamAbortCtrlRef.current?.abort();
    } catch {
      /* ignore */
    }
    speechQueueRef.current?.clear();
    stopAudio();
    window.speechSynthesis?.cancel();
    speakingRef.current = false;
    stopBargeWatch();
    wantListenRef.current = true;
    setPhase("listening");
    userBargeOpenRef.current = true;
    ignoreUntilRef.current = Date.now() + 120;
    return true;
  }

  function mergeTranscript(existing, next) {
    const a = String(existing || "").trim();
    const b = String(next || "").trim();
    if (!a) return b;
    if (!b) return a;
    if (b === a) return a;
    if (b.startsWith(a)) return b;
    if (a.startsWith(b)) return a;
    if (b.includes(a) && b.length >= a.length) return b;
    if (a.includes(b) && a.length >= b.length) return a;
    // Overlap: "मेरी बात" + "मेरी बात सुनो" → keep longer continuation
    const aWords = a.split(/\s+/);
    const bWords = b.split(/\s+/);
    for (let n = Math.min(aWords.length, bWords.length); n >= 1; n -= 1) {
      const tail = aWords.slice(-n).join(" ");
      const head = bWords.slice(0, n).join(" ");
      if (tail === head) {
        return `${aWords.slice(0, -n).join(" ")} ${b}`.trim();
      }
    }
    return `${a} ${b}`.trim();
  }

  function resetBargeCandidate() {
    bargeCandidateRef.current = { text: "", since: 0, updates: 0 };
  }

  function confirmedBargePartial(text) {
    const candidate = String(text || "").trim();
    if (!candidate) {
      resetBargeCandidate();
      return false;
    }
    if (isLikelyAgentEcho(candidate, lastSpokenRef.current)) {
      resetBargeCandidate();
      return false;
    }
    const words = candidate.split(/\s+/).filter(Boolean);
    // Strong enough on first hearing — don't wait for a 2nd partial to cut TTS.
    if (words.length >= 2 || candidate.length >= 8 || isMeaningfulBargeIn(candidate)) {
      bargeCandidateRef.current = { text: candidate, since: Date.now(), updates: 2 };
      return true;
    }
    const previous = bargeCandidateRef.current;
    const related = candidate.startsWith(previous.text) || previous.text.startsWith(candidate);
    if (!previous.text || !related) {
      bargeCandidateRef.current = { text: candidate, since: Date.now(), updates: 1 };
      return false;
    }
    const next = { ...previous, text: candidate, updates: previous.updates + 1 };
    bargeCandidateRef.current = next;
    return next.updates >= 2;
  }

  function tryBargeIn(text) {
    const candidate = String(text || "").trim();
    if (!candidate) return false;
    if (isNoiseTranscript(candidate, lastSpokenRef.current) || isLikelyAgentEcho(candidate, lastSpokenRef.current)) {
      return false;
    }
    const urgent = isUrgentUserCommand(candidate) || isLanguageSwitchCommand(candidate);
    const agentTalking = speakingRef.current || speechQueueRef.current?.busy;

    if (agentTalking) {
      // Cut agent as soon as we hear real user words (not echo).
      if (!urgent && !confirmedBargePartial(candidate)) return false;
      acceptedBargeTextRef.current = candidate;
      interruptSpeaking();
      // Always collect the FULL utterance after cutting — never reply to a half sentence.
      transcriptRef.current = mergeTranscript(transcriptRef.current, candidate);
      noteVoiceActivity(transcriptRef.current);
      setPhase("listening");
      coalesceExtendRef.current = 0;
      scheduleCoalesceFlush();
      return true;
    }

    // Not talking — accumulate toward a full turn.
    transcriptRef.current = mergeTranscript(transcriptRef.current, candidate);
    noteVoiceActivity(transcriptRef.current);
    coalesceExtendRef.current = 0;
    scheduleCoalesceFlush();
    return true;
  }

  function coalesceMs() {
    // After an interrupt, give the caller time to finish the whole thought.
    const base = userBargeOpenRef.current ? 1800 : 1400;
    const eagerness = Number(callSettings(agentRef.current).eagerness || 7);
    return Math.max(base, (11 - eagerness) * 200);
  }

  function utteranceLooksIncomplete(text) {
    const raw = String(text || "").trim();
    if (!raw) return true;
    if (/(?:like|and|or|but|so|because|कि|और|तो|लेकिन|या|अगर|जब|मतलब|yani|umm|uh)\s*$/i.test(raw)) {
      return true;
    }
    if (/[,،、]\s*$/.test(raw)) return true;
    return false;
  }

  function flushCoalescedUtterance() {
    clearTimeout(coalesceTimerRef.current);
    coalesceTimerRef.current = null;
    const spoken = (transcriptRef.current || heardRef.current || "").trim();
    if (spoken.length < 2) {
      transcriptRef.current = "";
      return;
    }
    if (utteranceLooksIncomplete(spoken) && coalesceExtendRef.current < 3) {
      coalesceExtendRef.current += 1;
      scheduleCoalesceFlush();
      return;
    }
    coalesceExtendRef.current = 0;
    userBargeOpenRef.current = false;
    transcriptRef.current = "";
    if (isNoiseTranscript(spoken, lastSpokenRef.current) || isLikelyAgentEcho(spoken, lastSpokenRef.current)) {
      heardRef.current = "";
      setHeardText("");
      return;
    }
    void acceptUserSpeech(spoken);
  }

  function scheduleCoalesceFlush() {
    clearTimeout(coalesceTimerRef.current);
    coalesceTimerRef.current = setTimeout(() => {
      flushCoalescedUtterance();
    }, coalesceMs());
  }

  function noteVoiceActivity(text = "") {
    lastVoiceActivityRef.current = Date.now();
    if (text) {
      heardRef.current = text;
      setHeardText(text);
    }
    // Keep delaying the send while they are still talking.
    if (coalesceTimerRef.current) scheduleCoalesceFlush();
  }

  async function acceptUserSpeech(text, { immediate = false } = {}) {
    const spoken = normalizeVoiceTranscript(text);
    if (!spoken) return;
    // Drop duplicate sends of the same line (echo / double final).
    const now = Date.now();
    if (
      spoken === lastSentUserRef.current.text
      && now - lastSentUserRef.current.at < 3500
    ) {
      return;
    }
    if (speakingRef.current || speechQueueRef.current?.busy) {
      interruptSpeaking();
    }
    if (sendingRef.current) {
      pendingUserRef.current = spoken;
      heardRef.current = spoken;
      setHeardText(spoken);
      setPendingUserText(spoken);
      return;
    }
    if (immediate) {
      clearTimeout(coalesceTimerRef.current);
      transcriptRef.current = "";
    }
    lastSentUserRef.current = { text: spoken, at: now };
    userBargeOpenRef.current = false;
    await send(spoken);
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
    const languageHint = sttLanguageHintRef.current;
    sttLanguageHintRef.current = "";
    pendingUserRef.current = "";
    speakAbortRef.current = false;
    clearTimeout(silenceRef.current);
    clearTimeout(coalesceTimerRef.current);
    clearNudgeTimer();
    nudgeIndexRef.current = 0;
    // Keep streaming STT alive during think/speak so barge-in hears the full interrupt.
    if (modeRef.current !== "voice" || !streamSttRef.current) {
      stopListening();
    }
    stopBargeWatch();
    setDraft("");
    transcriptRef.current = "";
    heardRef.current = spoken;
    setPendingUserText(spoken);
    setHeardText(spoken);
    setLiveText("");
    setPhase("thinking");
    let nextCall = null;
    const streamCtrl = new AbortController();
    streamAbortCtrlRef.current = streamCtrl;
    try {
      if (modeRef.current === "voice") {
        wantListenRef.current = true;
        // Keep lastSpoken until TTS starts so post-turn speaker echo is still filtered.
        ttsPrepRef.current = new Map();

        let display = "";
        let speakBuffer = "";
        let spokeDuringStream = false;
        const queuedSpeakable = new Set();

        const pushSpeakable = (chunk) => {
          if (!chunk || speakAbortRef.current) return;
          const trimmed = String(chunk).trim();
          if (!trimmed) return;
          // Skip if we already queued/spoke this exact clause in this turn.
          if (queuedSpeakable.has(trimmed)) return;
          queuedSpeakable.add(trimmed);
          if (!speechQueueRef.current) {
            speechQueueRef.current = createSpeechQueue({
              play: (text) => speakChunk(text),
              onStart: () => {
                if (!speakingRef.current) {
                  speakingRef.current = true;
                  setPhase("speaking");
                  ignoreUntilRef.current = Date.now() + 120;
                  startBargeWatch();
                }
              },
              isAborted: () => speakAbortRef.current,
            });
          }
          speechQueueRef.current.push(trimmed);
          spokeDuringStream = true;
        };

        nextCall = await api.sendMessageStream(current.id, spoken, {
          source: "voice",
          signal: streamCtrl.signal,
          languageHint,
          onLanguage: (language, languageLocked) => {
            if (!callRef.current) return;
            const prevLock = callRef.current.languageLocked || callRef.current.language;
            callRef.current = {
              ...callRef.current,
              language,
              ...(languageLocked ? { languageLocked } : {}),
            };
            setCall(callRef.current);
            // Drop any leftover Telugu echo transcript after a language switch.
            if (languageLocked === "hi-IN" || language === "hi-IN" || language === "en-IN") {
              transcriptRef.current = "";
              heardRef.current = "";
            }
            const nextLock = languageLocked || language;
            if (nextLock && nextLock !== prevLock && /^(hi|en|te)-IN$/.test(nextLock)) {
              restartSttForLanguage();
            }
          },
          onDelta: (token) => {
            if (speakAbortRef.current) return;
            display += token;
            const cleanDisplay = stripModelControlText(display);
            setLiveText(cleanDisplay);
            speakBuffer += token;
            const sanitized = stripModelControlText(speakBuffer);
            const { speakable, rest } = pullSpeakable(sanitized);
            if (speakable) {
              speakBuffer = rest;
              pushSpeakable(speakable);
            }
          },
        });
        if (!nextCall && !speakAbortRef.current) {
          nextCall = await api.sendMessage(current.id, spoken, "voice", languageHint);
          const last = [...(nextCall?.messages || [])].reverse().find((m) => m.role === "assistant");
          if (last?.text) display = last.text;
        }
        if (nextCall) {
          callRef.current = nextCall;
          setCall(nextCall);
          // Drop live caption once the final message is committed (prevents duplicate bubble).
          setLiveText("");
        }

        if (!speakAbortRef.current) {
          const tail = stripModelControlText(speakBuffer || display);
          const { speakable } = pullSpeakable(tail, { force: true });
          if (speakable) pushSpeakable(speakable);

          if (spokeDuringStream && speechQueueRef.current) {
            try {
              await speechQueueRef.current.drain();
            } finally {
              stopBargeWatch();
              speakingRef.current = false;
              if (!userBargeOpenRef.current) {
                ignoreUntilRef.current = Date.now() + 550;
              }
              speechQueueRef.current = null;
            }
          } else {
            const finalAssistant = [...(nextCall?.messages || [])].reverse().find((m) => m.role === "assistant");
            const replyText = String(finalAssistant?.text || stripModelControlText(display)).trim();
            if (replyText) {
              speakingRef.current = true;
              setPhase("speaking");
                  ignoreUntilRef.current = Date.now() + 120;
              startBargeWatch();
              try {
                await speakTurn(replyText);
              } finally {
                stopBargeWatch();
                speakingRef.current = false;
              }
            }
          }
        } else {
          speechQueueRef.current?.clear();
          speechQueueRef.current = null;
        }
      } else {
        nextCall = await api.sendMessage(current.id, spoken, "chat");
      }
      if (nextCall) {
        callRef.current = nextCall;
        setCall(nextCall);
      } else if (!speakAbortRef.current) {
        throw new Error("No reply from agent");
      }
      setLiveText("");
      setHeardText("");
      setPendingUserText("");
      sendingRef.current = false;
      streamAbortCtrlRef.current = null;

      const barged = speakAbortRef.current;
      const pending = String(pendingUserRef.current || "").trim();
      if (modeRef.current === "voice") {
        if (pending) {
          pendingUserRef.current = "";
          await send(pending);
          return;
        }
        if (isLive(nextCall || callRef.current)) {
          if (!barged) await delay(120);
          resumeListening();
        } else {
          await stopMic();
          setPhase("idle");
        }
      } else {
        setPhase("idle");
      }
    } catch (err) {
      if (err?.name !== "AbortError") setError(err.message);
      setPhase("idle");
      speechQueueRef.current?.clear();
      speechQueueRef.current = null;
      speakingRef.current = false;
      stopBargeWatch();
      sendingRef.current = false;
      streamAbortCtrlRef.current = null;
      const pending = String(pendingUserRef.current || "").trim();
      if (pending && isLive(callRef.current) && modeRef.current === "voice") {
        pendingUserRef.current = "";
        await send(pending);
        return;
      }
      if (isLive(callRef.current) && modeRef.current === "voice") resumeListening();
    } finally {
      sendingRef.current = false;
    }
  }

  function resumeListening() {
    if (!isLive() || modeRef.current !== "voice") return;
    wantListenRef.current = true;
    setPhase("listening");
    scheduleNudge();
    setTimeout(() => {
      if (!wantListenRef.current || !isLive()) return;
      if (speakingRef.current && !callSettings(agentRef.current).allowInterrupt) return;
      if (!asrLoopRef.current && !recognitionRef.current && !streamSttRef.current) startRecognition();
    }, 80);
  }

  async function mark(status, disposition, reason) {
    const current = callRef.current;
    if (!current) return;
    wantListenRef.current = false;
    stopListening();
    stopBargeWatch();
    speakAbortRef.current = true;
    speechQueueRef.current?.clear();
    window.speechSynthesis?.cancel();
    stopAudio();
    const next = await api.outcome(current.id, { status, disposition, reason });
    callRef.current = next;
    setCall(next);
    setPhase("idle");
    await stopMic();
  }

  async function startMic(callId) {
    if (!navigator.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;
    let recordingStream = stream;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const context = new AudioContext();
      if (context.state === "suspended") await context.resume().catch(() => {});
      const destination = context.createMediaStreamDestination();
      const micSource = context.createMediaStreamSource(stream);
      micSource.connect(destination);
      recordingAudioContextRef.current = context;
      recordingDestinationRef.current = destination;
      recordingMicSourceRef.current = micSource;
      recordingStream = destination.stream;
    }
    const preferredType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ].find((type) => window.MediaRecorder?.isTypeSupported?.(type));
    const media = preferredType
      ? new MediaRecorder(recordingStream, { mimeType: preferredType })
      : new MediaRecorder(recordingStream);
    chunks.current = [];
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    recordingDoneRef.current = new Promise((resolve) => {
      media.onstop = async () => {
        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        try {
          if (blob.size) {
            const saved = await api.uploadRecording(callId, blob);
            if (callRef.current?.id === callId) {
              callRef.current = saved;
              setCall(saved);
            }
          }
        } catch (err) {
          setError(err?.message || "Call recording could not be saved.");
        } finally {
          try {
            recordingMicSourceRef.current?.disconnect();
          } catch {
            /* ignore */
          }
          recordingStream.getTracks().forEach((track) => track.stop());
          stream.getTracks().forEach((track) => track.stop());
          await recordingAudioContextRef.current?.close().catch(() => {});
          recordingAudioContextRef.current = null;
          recordingDestinationRef.current = null;
          recordingMicSourceRef.current = null;
          if (micStreamRef.current === stream) micStreamRef.current = null;
          resolve();
        }
      };
      media.onerror = () => {
        setError("Call recording stopped unexpectedly.");
        try {
          recordingMicSourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        recordingStream.getTracks().forEach((track) => track.stop());
        stream.getTracks().forEach((track) => track.stop());
        recordingAudioContextRef.current?.close().catch(() => {});
        recordingAudioContextRef.current = null;
        recordingDestinationRef.current = null;
        recordingMicSourceRef.current = null;
        if (micStreamRef.current === stream) micStreamRef.current = null;
        resolve();
      };
    });
    recorder.current = media;
    media.start(1000);
  }

  async function stopMic() {
    wantListenRef.current = false;
    clearTimeout(nudgeTimerRef.current);
    clearTimeout(coalesceTimerRef.current);
    pendingUserRef.current = "";
    acceptedBargeTextRef.current = "";
    resetBargeCandidate();
    stopListening();
    stopBargeWatch();
    speakAbortRef.current = true;
    try {
      streamAbortCtrlRef.current?.abort();
    } catch {
      /* ignore */
    }
    speechQueueRef.current?.clear();
    speakingRef.current = false;
    stopAudio();
    stopAmbient();
    const recordingDone = recordingDoneRef.current;
    if (recorder.current?.state === "recording") recorder.current.stop();
    if (recordingDone) await Promise.race([recordingDone, delay(15000)]);
    recorder.current = null;
    recordingDoneRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    window.speechSynthesis?.cancel();
  }

  function clearNudgeTimer() {
    clearTimeout(nudgeTimerRef.current);
    nudgeTimerRef.current = null;
  }

  function assistantIsWaitingForAnswer() {
    const messages = callRef.current?.messages || [];
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    const text = String(last?.text || "").trim();
    if (!text) return false;
    // Only nudge when the agent asked something and is waiting — not after a dead "okay/thanks".
    if (/[?？]\s*$/.test(text) || /\?\s/u.test(text)) return true;
    if (/क्या|है\s*\?|ना\s*\?|చెప్పండి|మాట్లాడొచ్చా|please|would you|can we|shall we/i.test(text) && /[?？]/.test(text)) {
      return true;
    }
    return false;
  }

  function scheduleNudge() {
    clearNudgeTimer();
    if (modeRef.current !== "voice" || !isLive() || speakingRef.current || sendingRef.current) return;
    const settings = callSettings(agentRef.current);
    if (!settings.nudgeEnabled) return;
    if (!assistantIsWaitingForAnswer()) return;
    const nudges = (settings.nudges || []).filter((n) => String(n?.message || "").trim());
    if (!nudges.length) return;
    const index = nudgeIndexRef.current;
    if (index >= nudges.length) {
      if (!settings.hangupAfterNudges) return;
      const waitMs = Math.max(12, Number(nudges[nudges.length - 1]?.afterSeconds || 14)) * 1000;
      nudgeTimerRef.current = setTimeout(() => {
        if (!wantListenRef.current || speakingRef.current || sendingRef.current || !isLive()) return;
        if (!assistantIsWaitingForAnswer()) return;
        mark("no_answer", "no_answer", "No response after nudges");
      }, waitMs);
      return;
    }
    const waitMs = Math.max(12, Number(nudges[index].afterSeconds || 14)) * 1000;
    quietSinceRef.current = Date.now();
    nudgeTimerRef.current = setTimeout(async () => {
      if (!wantListenRef.current || speakingRef.current || sendingRef.current || !isLive()) return;
      if (!assistantIsWaitingForAnswer()) return;
      const activeLanguage = callRef.current?.language || agentRef.current?.language || "en-IN";
      const localized = activeLanguage === "hi-IN"
        ? (index === 0 ? "हैलो, आप सुन रहे हैं?" : "हैलो?")
        : activeLanguage === "te-IN"
          ? (index === 0 ? "హలో అండి, వింటున్నారా?" : "హలో అండి?")
          : "";
      const message = localized || String(nudges[index].message || "").trim();
      nudgeIndexRef.current = index + 1;
      if (!message) {
        scheduleNudge();
        return;
      }
      wantListenRef.current = false;
      await speak(message);
      if (isLive()) resumeListening();
    }, waitMs);
  }

  function studioTtsPayload(text) {
    const spokenLang = callRef.current?.language || agentRef.current?.language || "en-IN";
    const settings = callSettings(agentRef.current);
    return {
      text,
      agentId: agentRef.current?.id,
      ttsProvider: agentRef.current?.ttsProvider,
      ttsVoice: agentRef.current?.ttsVoice,
      ttsModel: agentRef.current?.ttsModel,
      language: spokenLang,
      source: "studio",
      skipAmbient: true,
      callSettings: { ...settings, backgroundSound: "off" },
    };
  }

  function recordingCaptureOptions() {
    return {
      captureContext: recordingAudioContextRef.current,
      captureDestination: recordingDestinationRef.current,
    };
  }

  function prefetchTts(text) {
    const display = String(text || "").replace(/\[END:[a-z_]+\]/gi, "").trim();
    if (!display) return null;
    const ttsProvider = agentRef.current?.ttsProvider || "browser";
    if (ttsProvider === "browser") return null;
    const key = display;
    if (!ttsPrepRef.current.has(key)) {
      ttsPrepRef.current.set(
        key,
        api.speak(studioTtsPayload(display)).catch((err) => {
          ttsPrepRef.current.delete(key);
          throw err;
        })
      );
    }
    return ttsPrepRef.current.get(key);
  }

  async function speakChunk(text) {
    if (speakAbortRef.current) return;
    const display = String(text || "").replace(/\[END:[a-z_]+\]/gi, "").trim();
    const clean = spokenForTts(display);
    if (!clean) return;
    // Seed echo filter BEFORE audio plays so mic bleed of this line is ignored.
    lastSpokenRef.current = `${lastSpokenRef.current} ${display}`.trim().slice(-600);
    const spokenLang = callRef.current?.language || agentRef.current?.language || "en-IN";
    const ttsProvider = agentRef.current?.ttsProvider || "browser";
    const settings = callSettings(agentRef.current);
    if (ttsProvider !== "browser") {
      try {
        if (ttsProvider === "sarvam") {
          await playStreamingTts({
            text: clean,
            language: spokenLang,
            speaker: agentRef.current?.ttsVoice || "kavya",
            model: agentRef.current?.ttsModel || "bulbul:v3",
            pace: Number(settings.speakingSpeed ?? 1.02),
            pitch: Number(settings.pitch || 0),
            temperature: Number(settings.ttsTemperature ?? 0.58),
            dictId: settings.sarvamDictId || "",
            pronunciations: settings.pronunciations || null,
          }, recordingCaptureOptions());
        } else {
          const pending = prefetchTts(display) || api.speak(studioTtsPayload(display));
          const clip = await Promise.race([
            pending,
            delay(8000).then(() => Promise.reject(new Error("Voice timed out"))),
          ]);
          if (speakAbortRef.current) return;
          if (clip?.provider === "browser" || !clip?.audioUrl) {
            throw new Error("Selected voice is not connected. Add the API key in Settings.");
          }
          await Promise.race([playAudio(clip.audioUrl, recordingCaptureOptions()), delay(120000)]);
        }
      } catch (err) {
        if (speakAbortRef.current) return;
        const msg = String(err?.message || "Voice failed");
        if (ttsProvider === "sarvam") {
          setError(/invalid.*auth|api.?key|403|credentials/i.test(msg)
            ? "Sarvam voice failed — your API key is invalid. Get a fresh key from dashboard.sarvam.ai → API Keys, put it in .env as SARVAM_API_KEY, restart backend."
            : `Sarvam voice failed: ${msg}`);
          return;
        }
        try {
          const clip = await api.speak(studioTtsPayload(display));
          if (clip?.audioUrl) await playAudio(clip.audioUrl, recordingCaptureOptions());
          else throw new Error("No connected voice.");
        } catch {
          setError(msg);
        }
      }
      return;
    }
    await speakText(clean, {
      voice: voiceRef.current,
      lang: spokenLang,
      rate: Number(settings.speakingSpeed ?? 1),
      pitch: 1 + Number(settings.pitch || 0),
      cancel: false,
    });
  }

  async function speakTurn(text) {
    if (speakAbortRef.current) return;
    const display = String(text || "").replace(/\[END:[a-z_]+\]/gi, "").trim();
    if (!display) return;
    await speakChunk(display);
  }

  async function speak(text) {
    wantListenRef.current = true;
    speakAbortRef.current = false;
    clearNudgeTimer();
    if (!streamSttRef.current && !asrLoopRef.current && !recognitionRef.current) {
      startRecognition();
    }
    const display = String(text || "").replace(/\[END:[a-z_]+\]/gi, "").trim();
    if (!display) return;
    lastSpokenRef.current = display;
    speakingRef.current = true;
    setPhase("speaking");
    try {
      ignoreUntilRef.current = Date.now() + 100;
      startBargeWatch();
      ttsPrepRef.current = new Map();
      await speakTurn(display);
    } finally {
      stopBargeWatch();
      speakingRef.current = false;
      // If user already barged in, don't deafen them again.
      if (!userBargeOpenRef.current) {
        ignoreUntilRef.current = Date.now() + 550;
      }
    }
  }

  function stopBargeWatch() {
    const watch = bargeWatchRef.current;
    bargeWatchRef.current = null;
    if (!watch) return;
    clearInterval(watch.timer);
    try {
      watch.source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      watch.ctx?.close();
    } catch {
      /* ignore */
    }
  }

  function startBargeWatch() {
    stopBargeWatch();
    if (callSettings(agentRef.current).allowInterrupt === false) return;
    const stream = micStreamRef.current;
    if (!stream) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    let ctx;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let loudFrames = 0;
    // Energy barge: user near-mic is much louder than residual TTS after AEC.
    // STT stays muted while speaking, so this only cuts audio — then STT hears the user.
    const timer = setInterval(() => {
      if (!(speakingRef.current || speechQueueRef.current?.busy)) return;
      if (Date.now() < ignoreUntilRef.current) {
        loudFrames = 0;
        return;
      }
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      if (rms >= 0.07) {
        loudFrames += 1;
        if (loudFrames >= 3) {
          loudFrames = 0;
          interruptSpeaking();
          setPhase("listening");
        }
      } else {
        loudFrames = Math.max(0, loudFrames - 1);
      }
    }, 40);
    bargeWatchRef.current = { timer, ctx, source };
  }

  function stopListening() {
    asrLoopRef.current = false;
    asrGenerationRef.current += 1;
    clearTimeout(silenceRef.current);
    clearTimeout(coalesceTimerRef.current);
    clearNudgeTimer();
    try {
      streamSttRef.current?.stop();
    } catch {
      /* ignore */
    }
    streamSttRef.current = null;
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
    acceptedBargeTextRef.current = "";
    resetBargeCandidate();
    scheduleNudge();
    startRecognition();
  }

  function sttLanguage() {
    // Only force STT after an explicit/content lock. Using call.language (agent default
    // te-IN) here made Hindi speech come back as Telugu gibberish and blocked switching.
    const locked = callRef.current?.languageLocked;
    if (locked === "hi-IN" || locked === "en-IN" || locked === "te-IN") return locked;
    const settings = callSettings(agentRef.current);
    if (settings.autoDetectLanguage !== false || settings.switchLanguage !== false) return "auto";
    return callRef.current?.language || agentRef.current?.language || "auto";
  }

  function restartSttForLanguage() {
    if (modeRef.current !== "voice" || !wantListenRef.current || !isLive()) return;
    try {
      streamSttRef.current?.stop();
    } catch {
      /* ignore */
    }
    streamSttRef.current = null;
    asrLoopRef.current = false;
    startRecognition();
  }

  async function startSarvamLoop() {
    if (asrLoopRef.current || streamSttRef.current) return;
    asrLoopRef.current = true;
    const loopId = (asrGenerationRef.current += 1);
    setPhase("listening");
    const allowUplink = () => {
      if (!wantListenRef.current || !isLive()) return false;
      if (Date.now() < ignoreUntilRef.current) return false;
      const settings = callSettings(agentRef.current);
      // Greeting + later turns: keep mic open while agent speaks so interrupt works.
      // Echo of agent TTS is filtered in tryBargeIn / isLikelyAgentEcho.
      if (speakingRef.current || speechQueueRef.current?.busy) {
        return settings.allowInterrupt !== false;
      }
      if (sendingRef.current && !userBargeOpenRef.current) return false;
      return true;
    };

    try {
      const session = await startStreamingStt({
        language: sttLanguage(),
        // Cap eagerness so mid-phrase pauses aren't treated as end-of-turn.
        // Lower eagerness → longer endpointing so full sentences are captured.
        eagerness: 4,
        mediaStream: micStreamRef.current,
        shouldSend: allowUplink,
        onReady: () => {
          if (asrGenerationRef.current === loopId) {
            if (!speakingRef.current) setPhase("listening");
          }
        },
        onVadStart: () => {
          if (!wantListenRef.current || asrGenerationRef.current !== loopId) return;
          if (Date.now() < ignoreUntilRef.current) return;
          resetBargeCandidate();
          clearNudgeTimer();
        },
        onPartial: (text) => {
          if (!wantListenRef.current || asrGenerationRef.current !== loopId) return;
          if (!text) return;
          const urgent = isUrgentUserCommand(text) || isLanguageSwitchCommand(text);
          if (Date.now() < ignoreUntilRef.current && !urgent) return;
          if (isLikelyAgentEcho(text, lastSpokenRef.current)) return;
          const active = speakingRef.current || speechQueueRef.current?.busy;
          if (active) {
            if (callSettings(agentRef.current).allowInterrupt === false) return;
            if (tryBargeIn(text)) return;
            return;
          }
          if (sendingRef.current) {
            if (userBargeOpenRef.current) {
              transcriptRef.current = mergeTranscript(transcriptRef.current, text);
              noteVoiceActivity(transcriptRef.current);
            }
            return;
          }
          if (isNoiseTranscript(text, lastSpokenRef.current)) return;
          // Live caption while speaking — prefer latest partial as the growing phrase.
          transcriptRef.current = mergeTranscript(transcriptRef.current, text);
          noteVoiceActivity(transcriptRef.current);
          clearNudgeTimer();
          if (!coalesceTimerRef.current) scheduleCoalesceFlush();
        },
        onFinal: async (text, meta = {}) => {
          if (!wantListenRef.current || asrGenerationRef.current !== loopId) return;
          if (/^(te|hi|en)-IN$/.test(String(meta.language || ""))) {
            sttLanguageHintRef.current = meta.language;
          }
          let spoken = normalizeVoiceTranscript(text);
          if (spoken.length < 2) return;
          const urgent = isUrgentUserCommand(spoken) || isLanguageSwitchCommand(spoken);
          if (Date.now() < ignoreUntilRef.current && !urgent) return;
          if (isLikelyAgentEcho(spoken, lastSpokenRef.current) && !urgent) return;
          const active = speakingRef.current || speechQueueRef.current?.busy;
          if (active) {
            if (callSettings(agentRef.current).allowInterrupt === false) return;
            if (tryBargeIn(spoken)) return;
            return;
          }
          if (sendingRef.current) {
            if (userBargeOpenRef.current || urgent) {
              pendingUserRef.current = mergeTranscript(pendingUserRef.current, spoken);
              setPendingUserText(pendingUserRef.current);
            }
            return;
          }
          acceptedBargeTextRef.current = "";
          resetBargeCandidate();
          if (isNoiseTranscript(spoken, lastSpokenRef.current)) return;
          transcriptRef.current = mergeTranscript(transcriptRef.current, spoken);
          noteVoiceActivity(transcriptRef.current);
          clearNudgeTimer();
          scheduleCoalesceFlush();
        },
        onError: (message) => {
          if (asrGenerationRef.current !== loopId) return;
          console.warn("Streaming STT:", message);
          try {
            streamSttRef.current?.stop();
          } catch {
            /* ignore */
          }
          streamSttRef.current = null;
          asrLoopRef.current = false;
          if (wantListenRef.current && isLive()) startBrowserRecognition();
          else setError(message || "Live transcription failed");
        },
        onClose: () => {
          if (asrGenerationRef.current !== loopId) return;
          streamSttRef.current = null;
          asrLoopRef.current = false;
          if (wantListenRef.current && !sendingRef.current && isLive()) {
            setTimeout(() => {
              if (wantListenRef.current && !streamSttRef.current && isLive()) {
                startRecognition();
              }
            }, 200);
          }
        },
      });
      if (asrGenerationRef.current !== loopId) {
        session.stop();
        return;
      }
      streamSttRef.current = session;
    } catch (err) {
      asrLoopRef.current = false;
      streamSttRef.current = null;
      if (wantListenRef.current && asrGenerationRef.current === loopId) {
        startBrowserRecognition();
      } else if (wantListenRef.current) {
        setError(err.message || "Could not start live transcription");
      }
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
      if (speakingRef.current || speechQueueRef.current?.busy || sendingRef.current) {
        if (
          callSettings(agentRef.current).allowInterrupt
          && (speakingRef.current || speechQueueRef.current?.busy)
          && Date.now() >= ignoreUntilRef.current
        ) {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            interim += event.results[i][0].transcript;
          }
          const words = String(interim || "").trim().split(/\s+/).filter(Boolean);
          if (words.length >= 1 && String(interim).trim().length >= 3) {
            interruptSpeaking();
            heardRef.current = interim.trim();
            setHeardText(interim.trim());
          }
        }
        if (sendingRef.current && !(speakingRef.current || speechQueueRef.current?.busy)) {
          return;
        }
        // After interrupt, fall through to accumulate finals below when not speaking.
        if (speakingRef.current || speechQueueRef.current?.busy) return;
      }
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
          if (spoken.length >= 2) {
            if (isNoiseTranscript(spoken, lastSpokenRef.current)) {
              transcriptRef.current = "";
              heardRef.current = "";
              setHeardText("");
              return;
            }
            void acceptUserSpeech(spoken, { immediate: true });
          }
        }, Math.max(420, (11 - Number(agentRef.current?.callSettings?.eagerness || 7)) * 110));
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
          <MessageTimeline
            messages={call.messages}
            liveText={liveText}
            heardText={heardText}
            pendingUserText={pendingUserText}
          />
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
