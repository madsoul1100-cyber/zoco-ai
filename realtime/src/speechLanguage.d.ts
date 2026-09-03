export function looksLikeEnglishSentence(text: string): boolean;
export function detectExplicitLanguageSwitch(text: string): "en" | "hi" | "te" | null;
export function detectSpeechLanguage(
  text: string,
  current?: string,
  opts?: { locked?: boolean }
): "en" | "hi" | "te" | null;
export function isShortAffirmation(text: string): boolean;
export function looksLikeSttNoise(text: string, current?: string): boolean;
export function isLikelyAgentEcho(heard: string, lastSpoken?: string): boolean;
