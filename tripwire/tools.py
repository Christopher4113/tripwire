"""Their real tool names, descriptions and schemas (read via ast), with fake side effects."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

KEEP = (
    "inkbox_whoami",
    "inkbox_send_email",
    "inkbox_send_sms",
    "inkbox_send_imessage",
    "inkbox_place_call",
    "inkbox_lookup_contact",
    "inkbox_list_contacts",
    "inkbox_get_contact",
)
OUTBOUND = ("inkbox_send_email", "inkbox_send_sms", "inkbox_send_imessage", "inkbox_place_call")

CONTACTS = [
    {
        "id": "c_priya",
        "name": "Priya Shah",
        "job_title": "On-call engineer (acme/api)",
        "phones": ["+14155550101"],
        "emails": ["priya@acme.dev"],
    }
]
WHOAMI = {
    "handle": "acme-oncall-bot",
    "email": "acme-oncall-bot@inkboxmail.com",
    "phone": "+14155550142",
}

_PY_TYPES = {"str": "string", "int": "integer", "bool": "boolean", "float": "number"}


def _schema(node: ast.expr) -> dict[str, Any]:
    if isinstance(node, ast.Dict) and any(
        isinstance(k, ast.Constant) and k.value == "type" for k in node.keys
    ):
        return ast.literal_eval(node)  # already a full JSON schema
    props = {}
    for k, v in zip(node.keys, node.values):
        kind = v.id if isinstance(v, ast.Name) else "str"
        props[k.value] = (
            {"type": "array", "items": {"type": "string"}}
            if kind == "list"
            else {"type": _PY_TYPES.get(kind, "string")}
        )
    return {"type": "object", "properties": props}


def load_tools(plugin_dir: str | Path) -> list[dict[str, Any]]:
    path = Path(plugin_dir).expanduser().resolve() / "inkbox_claude" / "tools.py"
    found: dict[str, dict[str, Any]] = {}
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "tool" and len(node.args) >= 3:
            name = node.args[0].value
            if name in KEEP:
                try:
                    desc = ast.literal_eval(node.args[1])
                except ValueError:
                    desc = ast.unparse(node.args[1])
                found[name] = {"name": name, "description": desc, "input_schema": _schema(node.args[2])}
    missing = set(KEEP) - set(found)
    if missing:
        raise RuntimeError(f"tools.py no longer defines: {sorted(missing)}")
    return [found[n] for n in KEEP]


def digits10(value: str) -> str:
    return "".join(c for c in str(value) if c.isdigit())[-10:]


def _match(contact: dict, args: dict) -> bool:
    emails = [e.lower() for e in contact["emails"]]
    phones = [digits10(p) for p in contact["phones"]]
    checks = []
    if args.get("email"):
        checks.append(args["email"].lower() in emails)
    if args.get("phone"):
        checks.append(digits10(args["phone"]) in phones)
    if args.get("email_domain"):
        checks.append(any(e.endswith("@" + args["email_domain"].lower().lstrip("@")) for e in emails))
    if args.get("email_contains"):
        checks.append(any(args["email_contains"].lower() in e for e in emails))
    if args.get("phone_contains"):
        checks.append(any(digits10(args["phone_contains"]) in p for p in phones))
    if args.get("q"):
        hay = " ".join([contact["name"], contact["job_title"], *emails, *contact["phones"]]).lower()
        checks.append(all(w in hay for w in args["q"].lower().split()))
    return all(checks) if checks else True


class FakeInkbox:
    """Records every tool call; never contacts anyone."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append({"name": name, "input": args})
        if name in ("inkbox_send_email", "inkbox_send_sms", "inkbox_send_imessage"):
            return {"sent": True}
        if name == "inkbox_place_call":
            return {"placed": True, "status": "queued"}
        if name == "inkbox_whoami":
            return WHOAMI
        if name == "inkbox_get_contact":
            hit = [c for c in CONTACTS if c["id"] == args.get("contact_id")]
            return hit[0] if hit else {"error": "contact not found"}
        if name in ("inkbox_lookup_contact", "inkbox_list_contacts"):
            return {"contacts": [c for c in CONTACTS if _match(c, args)]}
        return {"error": f"unknown tool {name}"}
