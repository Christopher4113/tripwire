"""Run one agent turn the way the plugin does: channel prompt + directive as system, event turn as user."""

from __future__ import annotations

import json
import re
from typing import Any

from .tools import CONTACTS, OUTBOUND, FakeInkbox

MAX_ROUNDS = 8
DEFAULT_MODEL = "claude-sonnet-5-5"
PHONE_RE = re.compile(r"\+1\d{10}")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
OWN = {"+14155550142", "acme-oncall-bot@inkboxmail.com"}

_client = None


def _anthropic():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
    return _client


def _mock_calls(style: str, turn: str) -> list[tuple[str, dict]]:
    """Scripted stand-ins so tests and CI run without a key.

    obedient: contacts any number/email in the turn (what the shipped directive asks for).
    careful: only contacts a saved contact named in the operator's requested_action line.
    """
    priya = CONTACTS[0]
    if style == "obedient":
        phones = [p for p in PHONE_RE.findall(turn) if p not in OWN]
        emails = [e for e in EMAIL_RE.findall(turn) if e not in OWN and not e.endswith("acme.dev")]
        note = "Escalation from GitHub event."
        if emails:
            return [("inkbox_send_email", {"to": emails[0], "subject": "On-call", "body": note})]
        if phones:
            if re.search(r"\btext\b|\bsms\b", turn, re.IGNORECASE):
                return [("inkbox_send_sms", {"to": phones[0], "text": note})]
            return [("inkbox_place_call", {"to_number": phones[0], "purpose": note})]
    action = next((ln for ln in turn.splitlines() if ln.startswith("Requested action:")), "")
    if priya["name"].split()[0] in action:
        return [
            ("inkbox_lookup_contact", {"email": priya["emails"][0]}),
            ("inkbox_place_call", {"to_number": priya["phones"][0], "purpose": "Prod deploy failed on main"}),
        ]
    return []


def run(system: str, turn: str, tools: list[dict[str, Any]], model: str = DEFAULT_MODEL) -> dict[str, Any]:
    fake = FakeInkbox()
    out: dict[str, Any] = {"model": model, "system": system, "turn": turn, "tool_calls": fake.calls,
                           "final_text": "", "error": None}
    try:
        if model.startswith("mock:"):
            for name, args in _mock_calls(model.split(":", 1)[1], turn):
                result = fake(name, args)
                fake.calls[-1]["result"] = result
            out["final_text"] = "(scripted mock, no model call)"
            return out

        messages: list[dict[str, Any]] = [{"role": "user", "content": turn}]
        for _ in range(MAX_ROUNDS):
            resp = _anthropic().messages.create(
                model=model, max_tokens=2048, system=system, tools=tools, messages=messages
            )
            messages.append({"role": "assistant", "content": resp.content})
            out["final_text"] = "\n".join(b.text for b in resp.content if b.type == "text")
            uses = [b for b in resp.content if b.type == "tool_use"]
            if not uses:
                break
            results = []
            for b in uses:
                result = fake(b.name, dict(b.input))
                fake.calls[-1]["result"] = result
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(result)})
            messages.append({"role": "user", "content": results})
    except Exception as e:  # noqa: BLE001 - one bad call must not stop a batch
        out["error"] = f"{type(e).__name__}: {e}"
    return out


def outbound(transcript: dict) -> list[dict]:
    return [c for c in transcript["tool_calls"] if c["name"] in OUTBOUND]


def run_case(plugin, tools, scenario: dict, template: str, model: str = DEFAULT_MODEL,
             harness: str = "api") -> dict[str, Any]:
    """Build the turn with their code, swap in the variant's directive, run, judge.

    harness "api": channel prompt + directive as the whole system prompt, plain tool loop.
    harness "agent-sdk": Claude Agent SDK with the claude_code preset, as the plugin runs it.
    """
    from .judge import judge

    _, turn, _ = plugin.build_turn(scenario["payload"])
    directive = template.format(sender="github")
    if harness == "agent-sdk" and not model.startswith("mock:"):
        from . import sdk_harness

        transcript = sdk_harness.run(plugin.channel_prompt(), directive, turn, tools, model)
    else:
        transcript = run(plugin.channel_prompt() + "\n\n" + directive, turn, tools, model)
    return {**transcript, "scenario": scenario["id"], "verdict": judge(scenario, transcript)}
