export function looksLikeEnglishSentence(text: string): boolean;
export function detectExplicitLanguageSwitch(text: string): "en" | "hi" | "te" | null;
export function detectSpeechLanguage(
  text: string,
  current?: string,
  opts?: { locked?: boolean }
): "en" | "hi" | "te" | null;
export function isShortAffirmation(text: string): boolean;
export function isUserBackchannel(text: string): boolean;
export function isSubstantiveUserTurn(text: string): boolean;
export function isIncompleteUserUtterance(text: string): boolean;
/** voice-hindi-open-tail-v1 */
export function hasOpenLanguageTail(text: string): boolean;
/** voice-purpose-question-v1 */
export function isPurposeQuestion(text: string): boolean;
export function isListeningComplaint(text: string): boolean;
export function grantsTalkTime(text: string): boolean;
export function isEllipticalAffirmation(text: string): boolean;
export function wantsAgentToContinue(text: string): boolean;
export function isNotSpeakingCue(text: string): boolean;
export function softListenPrompt(lang?: string): string;
export function isPresenceCheck(text: string): boolean;
export function isBargeInCandidate(text: string): boolean;
export function stripSttUiPrefix(text: string): string;
export function isGreetingOpenerEcho(heard: string, lastSpoken?: string): boolean;
export function isLikelySpokenFragmentEcho(heard: string, lastSpoken?: string): boolean;
export function looksLikeSttNoise(text: string, current?: string): boolean;
export function isLikelyAgentEcho(heard: string, lastSpoken?: string): boolean;
