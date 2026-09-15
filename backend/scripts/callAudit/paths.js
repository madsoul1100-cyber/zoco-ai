import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Scratch space for the call audit. Gitignored — holds audio + transcripts. */
export const WORK_DIR = path.resolve(here, "../../../data/call-audit");
export const AUDIO_DIR = path.join(WORK_DIR, "audio");
export const TRANSCRIPT_DIR = path.join(WORK_DIR, "transcripts");
