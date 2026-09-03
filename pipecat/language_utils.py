"""Language helpers for Pipecat voice turns."""

from __future__ import annotations

import re


def speech_language(code: str) -> str:
    value = str(code or "en").lower()
    if value.startswith("hi"):
        return "hi"
    if value.startswith("te"):
        return "te"
    if value.startswith("ta"):
        return "ta"
    if value.startswith("en"):
        return "en"
    return "en"


def detect_reply_language(text: str, current: str = "en") -> str:
    """Pick TTS language from what the caller said (explicit switch or script)."""
    raw = str(text or "").strip()
    if not raw:
        return current
    lower = raw.lower()
    if (
        ("hindi" in lower and any(w in lower for w in ("speak", "talk", "in", "please", "better")))
        or ("हिंदी" in raw or "हिन्दी" in raw)
    ):
        return "hi"
    if "english" in lower and any(w in lower for w in ("speak", "talk", "in", "please")):
        return "en"
    if "telugu" in lower or "తెలుగు" in raw:
        return "te"
    if any("\u0900" <= ch <= "\u097f" for ch in raw):
        return "hi"
    if any("\u0c00" <= ch <= "\u0c7f" for ch in raw):
        return "te"
    if len(raw) >= 12 and raw.isascii():
        return "en"
    return current


def is_backchannel(text: str) -> bool:
    raw = re.sub(r"[^\w\s]+", " ", str(text or "").lower())
    raw = re.sub(r"\s+", " ", raw).strip()
    if not raw:
        return False
    if re.fullmatch(r"hmm+", raw):
        return True
    return raw in {
        "hello",
        "are you there",
        "hello are you there",
        "hello are you there yeah",
        "hello are you there yes",
        "yeah",
        "yes",
        "ok",
        "okay",
        "hlo",
    }
