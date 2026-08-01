"""Agentic RAG core — a tool-calling loop over the business's own data.

Provider-switchable via settings.AI_PROVIDER:
  - "groq"   → OpenAI-compatible chat-completions (Groq Llama-3.3-70b, free tier)
  - "claude" → Anthropic Messages API (paid API credits)

Both give Claude/Llama the read/write tools (chat/tools.py) scoped to the
caller's business_id; the model decides which to call, we execute them, feed
results back, and it composes a grounded answer in the user's language.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.config import get_settings
from apps.api.modules.chat.tools import TOOL_SCHEMAS, build_registry

logger = structlog.get_logger()

MAX_TOOL_ITERATIONS = 5
MAX_TOKENS = 3072
_NO_INFO = "I don't have that information yet."
_ERR = "Sorry, I couldn't process that just now. Please try again."

_LANG_LABEL = {
    "en": "English", "ak": "Twi (Akan)", "ee": "Ewe", "gaa": "Ga", "pcm": "Ghanaian Pidgin",
}


@dataclass
class AgentResult:
    reply: str
    tools_used: list[str] = field(default_factory=list)
    iterations: int = 0
    pending_action: dict | None = None


async def _business_context(db: AsyncSession, business_id: UUID) -> str:
    from apps.api.modules.business.models import Business

    b = (await db.execute(select(Business).where(Business.id == business_id))).scalar_one_or_none()
    if not b:
        return "a small business"
    return f"{b.name} (a {b.type} in Ghana)"


def _system_prompt(business_desc: str, language_label: str) -> str:
    return (
        f"You are Yɛ, the business assistant for {business_desc}. Today is {date.today().isoformat()}.\n"
        "Answer the owner's questions using ONLY data returned by the tools. Never invent or "
        "estimate numbers. If a tool returns nothing relevant or no tool fits, say you don't have "
        "that information yet.\n"
        "All money is in Ghana Cedis (GH₵). Be concise and practical — a sentence or two, then key "
        "numbers. Reason internally in English but write your FINAL answer entirely in "
        f"{language_label}."
    )


def _history_messages(history: list[dict], limit: int = 8) -> list[dict]:
    msgs = []
    for h in (history or [])[-limit:]:
        role = h.get("role")
        text = h.get("text") or h.get("content")
        if role in ("user", "assistant") and text:
            msgs.append({"role": role, "content": text})
    return msgs


async def _call_tool(registry: dict, name: str, args: dict) -> tuple[dict, bool]:
    """Run a tool; return (result, is_pending_proposal)."""
    fn = registry.get(name)
    if fn is None:
        return {"error": f"unknown tool {name}"}, False
    try:
        result = await fn(**(args or {}))
    except Exception as exc:  # noqa: BLE001
        logger.warning("chat.agent.tool_error", tool=name, error=str(exc))
        return {"error": str(exc)}, False
    is_pending = isinstance(result, dict) and bool(result.get("proposal_type"))
    return result, is_pending


async def run_agent(
    *,
    message: str,
    business_id: UUID,
    user_id: UUID | None,
    db: AsyncSession,
    language_code: str,
    history: list[dict] | None = None,
) -> AgentResult:
    settings = get_settings()
    language_label = _LANG_LABEL.get(language_code, "English")
    system_prompt = _system_prompt(await _business_context(db, business_id), language_label)
    registry = build_registry(business_id, user_id, db)
    hist = _history_messages(history)

    if (settings.AI_PROVIDER or "groq").lower() == "claude":
        return await _run_claude(message, system_prompt, registry, hist, settings)
    return await _run_groq(message, system_prompt, registry, hist, settings)


# ── Groq / OpenAI-compatible ────────────────────────────────────────────────
def _openai_tools() -> list[dict]:
    return [
        {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}
        for t in TOOL_SCHEMAS
    ]


async def _run_groq(message, system_prompt, registry, hist, settings) -> AgentResult:
    from openai import AsyncOpenAI

    key = settings.GROQ_API_KEY
    if not key or key.startswith("your-"):
        return AgentResult(reply="The assistant is not configured right now.")
    client = AsyncOpenAI(api_key=key, base_url=settings.GROQ_BASE_URL)
    model = settings.GROQ_CHAT_MODEL
    tools = _openai_tools()

    messages: list[dict] = [{"role": "system", "content": system_prompt}, *hist, {"role": "user", "content": message}]
    tools_used: list[str] = []
    pending_action: dict | None = None

    for iteration in range(MAX_TOOL_ITERATIONS):
        try:
            resp = await client.chat.completions.create(
                model=model, messages=messages, tools=tools, tool_choice="auto",
                temperature=0.2, max_tokens=1024,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("chat.agent.llm_error", provider="groq", error=str(exc), iteration=iteration)
            return AgentResult(reply=_ERR, iterations=iteration)

        choice = resp.choices[0].message
        tool_calls = choice.tool_calls or []
        if not tool_calls:
            return AgentResult(reply=(choice.content or "").strip() or _NO_INFO, tools_used=tools_used, iterations=iteration, pending_action=pending_action)

        messages.append({
            "role": "assistant",
            "content": choice.content or "",
            "tool_calls": [
                {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in tool_calls
            ],
        })
        for tc in tool_calls:
            tools_used.append(tc.function.name)
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result, is_pending = await _call_tool(registry, tc.function.name, args)
            if is_pending:
                pending_action = result
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, default=str)})
        logger.info("chat.agent.step", provider="groq", iteration=iteration, tools=tools_used)

    try:
        final = await client.chat.completions.create(model=model, messages=messages, temperature=0.2, max_tokens=800)
        return AgentResult(reply=(final.choices[0].message.content or "").strip() or _NO_INFO, tools_used=tools_used, iterations=MAX_TOOL_ITERATIONS, pending_action=pending_action)
    except Exception:  # noqa: BLE001
        return AgentResult(reply=_ERR, tools_used=tools_used, iterations=MAX_TOOL_ITERATIONS, pending_action=pending_action)


# ── Anthropic Claude (Messages API) ─────────────────────────────────────────
def _extract_text(content: list) -> str:
    return "".join(b.text for b in content if getattr(b, "type", None) == "text").strip()


async def _run_claude(message, system_prompt, registry, hist, settings) -> AgentResult:
    import anthropic

    key = settings.ANTHROPIC_API_KEY
    if not key or key.startswith("your-"):
        return AgentResult(reply="The assistant is not configured right now.")
    client = anthropic.AsyncAnthropic(api_key=key)
    model = settings.ANTHROPIC_CHAT_MODEL
    effort = settings.ANTHROPIC_CHAT_EFFORT

    extra: dict = {}
    if effort:
        extra["thinking"] = {"type": "adaptive"}
        extra["output_config"] = {"effort": effort}

    messages: list[dict] = [*hist, {"role": "user", "content": message}]
    tools_used: list[str] = []
    pending_action: dict | None = None

    for iteration in range(MAX_TOOL_ITERATIONS):
        try:
            resp = await client.messages.create(
                model=model, max_tokens=MAX_TOKENS, system=system_prompt,
                tools=TOOL_SCHEMAS, messages=messages, **extra,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("chat.agent.llm_error", provider="claude", error=str(exc), iteration=iteration)
            return AgentResult(reply=_ERR, iterations=iteration)

        if resp.stop_reason != "tool_use":
            return AgentResult(reply=_extract_text(resp.content) or _NO_INFO, tools_used=tools_used, iterations=iteration, pending_action=pending_action)

        messages.append({"role": "assistant", "content": resp.content})
        tool_results = []
        for block in resp.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            tools_used.append(block.name)
            result, is_pending = await _call_tool(registry, block.name, block.input or {})
            if is_pending:
                pending_action = result
            tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result, default=str)})
        messages.append({"role": "user", "content": tool_results})
        logger.info("chat.agent.step", provider="claude", iteration=iteration, tools=tools_used)

    try:
        final = await client.messages.create(model=model, max_tokens=MAX_TOKENS, system=system_prompt, messages=messages, **extra)
        return AgentResult(reply=_extract_text(final.content) or _NO_INFO, tools_used=tools_used, iterations=MAX_TOOL_ITERATIONS, pending_action=pending_action)
    except Exception:  # noqa: BLE001
        return AgentResult(reply=_ERR, tools_used=tools_used, iterations=MAX_TOOL_ITERATIONS, pending_action=pending_action)
