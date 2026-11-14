"""Pull Inkbox's real prompt code out of a local plugin checkout at runtime.

Nothing from their repos is copied here. gateway.py is parsed with `ast` (importing it
would pull in aiohttp, the Inkbox SDK and the Claude Agent SDK); prompts.py is stdlib-only
so it is loaded with importlib.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import typing
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Identity the eval agent runs as (see tools.py for the saved contact).
IDENTITY = {
    "identity_handle": "acme-oncall-bot",
    "email_address": "acme-oncall-bot@inkboxmail.com",
    "phone_number": "+14155550142",
}

REQUIRED_NAMES = ("EXTERNAL_EVENT_DIRECTIVE", "EXTERNAL_EVENT_UNVERIFIED_DIRECTIVE", "_build_external_event_turn")


@dataclass
class Plugin:
    directive: str  # claude-code verified directive (has a {sender} placeholder)
    unverified_directive: str
    hermes_directive: str | None
    _turn: Callable[..., tuple[str, str, str]]
    _channel_prompt: Callable[..., str]
    gateway_path: Path

    def build_turn(self, payload: dict[str, Any]) -> tuple[str, str, str]:
        """(chat_id, turn_text, directive) exactly as the gateway builds it for a signed GitHub event."""
        return self._turn(payload, request_id=str(uuid.uuid4()), verified=True, provider="github")

    def channel_prompt(self) -> str:
        return self._channel_prompt("/srv/acme-api", **IDENTITY)


def _constants(tree: ast.Module, names: tuple[str, ...]) -> dict[str, str]:
    out: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id in names:
                out[target.id] = ast.literal_eval(node.value)
    return out


def _find_function(tree: ast.Module, name: str) -> ast.FunctionDef | None:
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    return None


def load(plugin_dir: str | Path, hermes_dir: str | Path | None = None) -> Plugin:
    plugin_dir = Path(plugin_dir).expanduser().resolve()
    gateway = plugin_dir / "inkbox_claude" / "gateway.py"
    if not gateway.exists():
        raise FileNotFoundError(f"{gateway} not found. Pass --plugin <path to claude-code-plugin checkout>.")
    tree = ast.parse(gateway.read_text())
    consts = _constants(tree, REQUIRED_NAMES[:2])
    fn = _find_function(tree, "_build_external_event_turn")
    missing = [n for n in REQUIRED_NAMES[:2] if n not in consts] + ([] if fn else ["_build_external_event_turn"])
    if missing:
        raise RuntimeError(f"gateway.py no longer exposes: {', '.join(missing)}. tripwire needs updating.")

    fn.decorator_list = []  # drop @staticmethod so it runs as a plain function
    ns: dict[str, Any] = {"hashlib": hashlib, "json": json, **consts}
    ns.update({n: getattr(typing, n) for n in ("Any", "Dict", "Tuple", "List", "Optional")})
    exec(compile(ast.Module(body=[fn], type_ignores=[]), str(gateway), "exec"), ns)  # noqa: S102 - their function, parsed from a checkout the user cloned

    spec = importlib.util.spec_from_file_location("_inkbox_prompts", plugin_dir / "inkbox_claude" / "prompts.py")
    prompts = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(prompts)

    hermes = None
    if hermes_dir:
        adapter = Path(hermes_dir).expanduser().resolve() / "adapter.py"
        hermes = _constants(ast.parse(adapter.read_text()), ("EXTERNAL_EVENT_DIRECTIVE",)).get(
            "EXTERNAL_EVENT_DIRECTIVE"
        )
        if hermes is None:
            raise RuntimeError(f"{adapter} no longer exposes EXTERNAL_EVENT_DIRECTIVE")

    return Plugin(
        directive=consts["EXTERNAL_EVENT_DIRECTIVE"],
        unverified_directive=consts["EXTERNAL_EVENT_UNVERIFIED_DIRECTIVE"],
        hermes_directive=hermes,
        _turn=ns["_build_external_event_turn"],
        _channel_prompt=prompts.build_channel_prompt,
        gateway_path=gateway,
    )
