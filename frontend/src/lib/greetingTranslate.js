import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { voiceGender } from "./providers.js";

function isAsciiGreeting(text) {
  return /^[\x00-\x7F\s.,'"’-]+$/.test(text || "");
}

export async function withSpokenGreeting(agent, catalog, { language, gender } = {}) {
  const current = agent || {};
  const lang = language || current.language || "en-IN";
  const spokenGender = gender || voiceGender(catalog, current);
  const greetings = { ...(current.greetings || {}) };
  if (!greetings["en-IN"] && isAsciiGreeting(current.greeting)) {
    greetings["en-IN"] = current.greeting;
  }
  if (lang === "en-IN") {
    return {
      agent: {
        ...current,
        language: lang,
        greeting: greetings["en-IN"] || current.greeting,
        greetings,
        greetingGender: spokenGender,
      },
      error: null,
    };
  }

  const cacheKey = `${lang}:${spokenGender}`;
  if (greetings[cacheKey]) {
    return {
      agent: {
        ...current,
        language: lang,
        greeting: greetings[cacheKey],
        greetings,
        greetingGender: spokenGender,
      },
      error: null,
    };
  }

  const source = greetings["en-IN"] || "";
  if (!source.trim()) {
    return {
      agent: { ...current, language: lang, greetings, greetingGender: spokenGender },
      error: null,
    };
  }

  try {
    const result = await api.translate({
      text: source,
      from: "en-IN",
      to: lang,
      speakerGender: spokenGender,
    });
    greetings[cacheKey] = result.text;
    greetings[lang] = result.text;
    return {
      agent: {
        ...current,
        language: lang,
        greeting: result.text,
        greetings,
        greetingGender: spokenGender,
      },
      error: null,
    };
  } catch (err) {
    return {
      agent: { ...current, language: lang, greetings, greetingGender: spokenGender },
      error: err,
    };
  }
}

export function useGreetingGenderSync(agent, catalog, onChange) {
  const genderSyncRef = useRef("");
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    if (!agent || !catalog) return;
    const lang = agent.language || "en-IN";
    if (lang === "en-IN") return;
    const nextGender = voiceGender(catalog, agent);
    if (agent.greetingGender === nextGender) return;
    const stamp = `${agent.id}:${agent.ttsVoice || ""}:${nextGender}`;
    if (genderSyncRef.current === stamp) return;
    genderSyncRef.current = stamp;
    setTranslating(true);
    withSpokenGreeting(agent, catalog, { gender: nextGender })
      .then(({ agent: next }) => onChange(next))
      .finally(() => setTranslating(false));
  }, [agent?.id, catalog, agent?.ttsVoice, agent?.language, agent?.greetingGender]);

  return translating;
}
