"""Real-Inkbox check: would an unknown recipient get through this identity's outbound filters?"""

from __future__ import annotations


def check(handle: str) -> int:
    try:
        from inkbox import Inkbox
    except ImportError:
        print("Install the live extra first: uv sync --extra live")
        return 2
    identity = Inkbox().get_identity(handle)  # INKBOX_API_KEY or ~/.inkbox/config
    rows = [
        ("mail", identity.mail_outbound_filter_mode),
        ("phone", identity.phone_outbound_filter_mode),
    ]
    print(f"identity {handle}")
    open_channels = 0
    for channel, mode in rows:
        allowed = str(mode).lower().endswith("blacklist")
        open_channels += allowed
        verdict = "ALLOWED (blacklist: anyone not explicitly blocked)" if allowed else "BLOCKED unless allow-listed"
        print(f"  {channel:<6} outbound mode={mode}  unknown recipient -> {verdict}")
    if open_channels:
        print("Outbound filters will not stop a prompt-injected send to an attacker. Consider whitelist mode.")
    return 0
