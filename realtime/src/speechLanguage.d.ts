export function looksLikeEnglishSentence(text: string): boolean;
export function detectSpeechLanguage(text: string, current?: string): "en" | "hi" | "te" | null;
export function looksLikeSttNoise(text: string, current?: string): boolean;
export function isLikelyAgentEcho(heard: string, lastSpoken?: string): boolean;
