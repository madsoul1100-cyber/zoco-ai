import asyncio
import os
import uuid
from typing import Any

import aiohttp

def _is_placeholder(value: str) -> bool:
    raw = str(value or "").strip()
    return not raw or raw == "..." or (raw.startswith("<") and raw.endswith(">"))


def _bridge_token() -> str:
    raw = str(os.getenv("PIPECAT_BRIDGE_TOKEN") or os.getenv("LIVEKIT_BRIDGE_TOKEN") or "").strip()
    if not _is_placeholder(raw):
        return raw
    secret = str(os.getenv("LIVEKIT_API_SECRET") or os.getenv("PIPECAT_API_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("PIPECAT_BRIDGE_TOKEN is not configured")
    return f"zoco-{secret[:24]}"


def _base_url() -> str:
    return str(os.getenv("ZOCO_BRIDGE_URL") or os.getenv("PUBLIC_BASE_URL") or "http://127.0.0.1:8787").rstrip("/")


def event_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_bridge_token()}",
        "Content-Type": "application/json",
    }


async def _request(method: str, path: str, payload: dict | None = None) -> dict[str, Any]:
    url = f"{_base_url()}{path}"
    async with aiohttp.ClientSession() as session:
        async with session.request(method, url, json=payload, headers=_headers()) as response:
            data = await response.json(content_type=None)
            if response.status >= 400:
                message = data.get("error") if isinstance(data, dict) else None
                raise RuntimeError(message or f"Zoco bridge failed ({response.status})")
            return data if isinstance(data, dict) else {}


async def fetch_snapshot(call_id: str) -> dict[str, Any]:
    return await _request("GET", f"/api/pipecat/sessions/{call_id}/snapshot")


async def post_tool(call_id: str, name: str, args: dict | None = None) -> dict[str, Any]:
    return await _request(
        "POST",
        f"/api/pipecat/sessions/{call_id}/tools",
        {"eventId": event_id("tool"), "name": name, "args": args or {}},
    )


async def post_event(call_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return await _request("POST", f"/api/pipecat/sessions/{call_id}/events", payload)


async def record_transcript(call_id: str, role: str, text: str) -> None:
    trimmed = str(text or "").strip()
    if not trimmed:
        return
    await post_event(
        call_id,
        {
            "eventId": event_id("usr" if role == "user" else "asst" if role == "assistant" else "sys"),
            "type": "transcript",
            "role": role,
            "text": trimmed,
        },
    )


async def record_status(call_id: str, status: str, reason: str | None = None) -> None:
    await post_event(
        call_id,
        {
            "eventId": event_id("status"),
            "type": "status",
            "status": status,
            "reason": reason,
        },
    )


async def record_disposition(call_id: str, disposition: str, reason: str | None = None) -> None:
    await post_event(
        call_id,
        {
            "eventId": event_id("disp"),
            "type": "disposition",
            "disposition": disposition,
            "reason": reason,
        },
    )


async def record_metric(call_id: str, name: str, value: float | str) -> None:
    await post_event(
        call_id,
        {
            "eventId": event_id("metric"),
            "type": "metric",
            "metrics": {"name": name, "value": value},
        },
    )


def fire(coro) -> None:
    asyncio.create_task(coro)
