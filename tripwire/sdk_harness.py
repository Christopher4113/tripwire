"""Run a turn the way the plugin really does: Claude Agent SDK, claude_code preset, in-process MCP tools.

Mirrors the ClaudeAgentOptions in their sessions.py: preset system prompt with the channel prompt and
directive appended, Inkbox tools on an "inkbox" MCP server, their default auto-allowed tools.
Two deliberate differences, for a reproducible eval: the agent runs in an empty sandbox dir, and no
user/project settings are loaded (otherwise the operator's own CLAUDE.md and plugins leak in).
Inkbox tools stay fake: same names, descriptions and schemas, nothing is sent.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
import warnings
from typing import Any

from .tools import FakeInkbox

# Same as the plugin: allowed tools skip can_use_tool. The SDK warns about that; it is intended here.
warnings.filterwarnings("ignore", message="can_use_tool will not be invoked")

# Their DEFAULT_AUTO_ALLOWED_TOOLS (config.py). Anything else would escalate to a human, and an
# external-event thread has none, so it is denied.
AUTO_ALLOWED = ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite", "Task", "NotebookRead"]
MAX_TURNS = 12


async def _run(channel_prompt: str, directive: str, turn: str, tools: list[dict], model: str) -> dict[str, Any]:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeAgentOptions,
        ClaudeSDKClient,
        PermissionResultDeny,
        ResultMessage,
        TextBlock,
        ToolUseBlock,
        create_sdk_mcp_server,
        tool,
    )

    fake = FakeInkbox()

    def make(spec: dict):
        @tool(spec["name"], spec["description"], spec["input_schema"])
        async def handler(args: dict[str, Any]) -> dict[str, Any]:
            result = fake(spec["name"], dict(args))
            fake.calls[-1]["result"] = result
            return {"content": [{"type": "text", "text": json.dumps(result)}]}

        return handler

    server = create_sdk_mcp_server("inkbox", tools=[make(t) for t in tools])
    builtin_calls: list[dict] = []

    async def can_use_tool(name, tool_input, _ctx):
        builtin_calls.append({"name": name, "input": tool_input, "denied": True})
        return PermissionResultDeny(message="No human approver is available on an external-event thread.")

    with tempfile.TemporaryDirectory(prefix="tripwire-sandbox-") as sandbox:
        options = ClaudeAgentOptions(
            cwd=sandbox,
            model=model,
            system_prompt={"type": "preset", "preset": "claude_code", "append": f"{channel_prompt}\n\n{directive}"},
            setting_sources=[],
            allowed_tools=AUTO_ALLOWED + [f"mcp__inkbox__{t['name']}" for t in tools],
            mcp_servers={"inkbox": server},
            can_use_tool=can_use_tool,
            max_turns=MAX_TURNS,
        )
        texts: list[str] = []
        other_tools: list[str] = []
        async with ClaudeSDKClient(options=options) as client:
            await client.query(turn)
            async for msg in client.receive_response():
                if isinstance(msg, AssistantMessage):
                    for b in msg.content:
                        if isinstance(b, TextBlock):
                            texts.append(b.text)
                        elif isinstance(b, ToolUseBlock) and not b.name.startswith("mcp__inkbox__"):
                            other_tools.append(b.name)
                elif isinstance(msg, ResultMessage):
                    break
    return {"tool_calls": fake.calls, "final_text": "\n".join(texts).strip(),
            "builtin_tools": other_tools, "denied": builtin_calls}


def run(channel_prompt: str, directive: str, turn: str, tools: list[dict], model: str) -> dict[str, Any]:
    out: dict[str, Any] = {"model": model, "harness": "agent-sdk", "system": f"[claude_code preset]\n\n{channel_prompt}\n\n{directive}",
                           "turn": turn, "tool_calls": [], "final_text": "", "error": None}
    try:
        out.update(asyncio.run(_run(channel_prompt, directive, turn, tools, model)))
    except Exception as e:  # noqa: BLE001 - one bad run must not stop a batch
        out["error"] = f"{type(e).__name__}: {e}"
    return out
