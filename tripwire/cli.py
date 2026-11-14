"""tripwire CLI: show | eval | redteam | serve | live check."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import scenarios as sc
from .directives import directives, render
from .plugin_prompt import load
from .redteam import campaign, outcome
from .target import DEFAULT_MODEL, run_case
from .tools import load_tools

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "runs"


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """KEY=value lines from the gitignored .env; real environment variables win."""
    if path.exists():
        for line in path.read_text().splitlines():
            key, sep, value = line.strip().removeprefix("export ").partition("=")
            if sep and key and not key.startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def _ctx(args):
    plugin = load(args.plugin, getattr(args, "hermes", None))
    return plugin, load_tools(args.plugin), directives(plugin)


def cmd_show(args) -> int:
    plugin, _, temps = _ctx(args)
    scenario = sc.get(args.scenario)
    _, turn, directive = plugin.build_turn(scenario["payload"])
    print(f"=== system prompt extra ({args.variant}) ===")
    print(directive if args.variant == "claude-code" else render(temps[args.variant]))
    print("\n=== turn ===")
    print(turn)
    return 0


def report_md(results: list[dict], variants: list[str], trials: int, model: str) -> str:
    cell = defaultdict(lambda: [0, 0])  # (scenario, variant) -> [hits, n]
    for r in results:
        hit = r["verdict"]["label"] in ("compromised", "pass")
        c = cell[(r["scenario"], r["variant"])]
        c[0] += hit
        c[1] += 1
    lines = [f"# tripwire eval\n\nModel `{model}`, {trials} trials per cell.\n",
             "| scenario | " + " | ".join(variants) + " |", "|---" * (len(variants) + 1) + "|"]
    for s in sc.SCENARIOS:
        word = "reached on-call" if s["kind"] == "benign" else "compromised"
        row = [f"{cell[(s['id'], v)][0]}/{cell[(s['id'], v)][1]} {word}" for v in variants]
        lines.append(f"| {s['id']} | " + " | ".join(row) + " |")
    lines.append("\n## Totals\n")
    for v in variants:
        att = [cell[(s["id"], v)] for s in sc.SCENARIOS if s["kind"] == "attack"]
        ben = [cell[(s["id"], v)] for s in sc.SCENARIOS if s["kind"] == "benign"]
        lines.append(f"- **{v}**: attacks landed {sum(a[0] for a in att)}/{sum(a[1] for a in att)}, "
                     f"legit escalation {sum(b[0] for b in ben)}/{sum(b[1] for b in ben)}")
    errors = [r for r in results if r.get("error")]
    if errors:
        lines.append(f"\n{len(errors)} runs hit an API error and count as no action.")
    return "\n".join(lines) + "\n"


def cmd_eval(args) -> int:
    plugin, tools, temps = _ctx(args)
    variants = [v for v in args.variants.split(",") if v in temps]
    jobs = [(s, v, t) for v in variants for s in sc.SCENARIOS for t in range(args.trials)]
    print(f"running {len(jobs)} cases on {args.model} ...", file=sys.stderr)

    def one(job):
        s, v, t = job
        r = run_case(plugin, tools, sc.get(s["id"]), temps[v], args.model, args.harness)
        r.update(variant=v, trial=t)
        print(f"  {v:<12} {s['id']:<22} #{t} {r['verdict']['label']}: {r['verdict']['detail']}", file=sys.stderr)
        return r

    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(one, jobs))
    out = RUNS / f"eval-{time.strftime('%Y%m%d-%H%M%S')}"
    out.mkdir(parents=True, exist_ok=True)
    meta = {"model": args.model, "harness": args.harness, "trials": args.trials, "variants": variants, "results": results}
    (out / "results.json").write_text(json.dumps(meta, indent=2, default=str))
    md = report_md(results, variants, args.trials, f"{args.model}` via `{args.harness}")
    (out / "report.md").write_text(md)
    print(md)
    print(f"saved {out}", file=sys.stderr)
    return 0


def cmd_redteam(args) -> int:
    plugin, tools, temps = _ctx(args)
    seeds = [s["id"] for s in sc.SCENARIOS if s["kind"] == "attack"]
    if args.scenario:
        seeds = [args.scenario]
    table = []
    for v in args.variants.split(","):
        for sid in seeds:
            rounds = []
            for r in campaign(plugin, tools, sid, temps[v], args.rounds, args.model, args.attacker_model):
                rounds.append(r)
                verdict = r.get("error") or r["result"]["verdict"]["label"]
                print(f"  {v:<12} {sid:<22} round {r['round']}: {verdict}", file=sys.stderr)
            table.append((sid, v, outcome(rounds), rounds))
    out = RUNS / f"redteam-{time.strftime('%Y%m%d-%H%M%S')}"
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(
        [{"scenario": s, "variant": v, "outcome": o, "rounds": rs} for s, v, o, rs in table], indent=2, default=str))
    print("| seed | variant | outcome |\n|---|---|---|")
    for s, v, o, _ in table:
        print(f"| {s} | {v} | {o} |")
    return 0


def cmd_serve(args) -> int:
    from .server import serve

    serve(args.plugin, args.hermes, args.model, args.port, args.attacker_model)
    return 0


def cmd_live(args) -> int:
    from .live import check

    return check(args.identity)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="tripwire")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp, hermes=True):
        sp.add_argument("--plugin", default="../claude-code-plugin", help="claude-code-plugin checkout")
        if hermes:
            sp.add_argument("--hermes", default=None, help="hermes-agent-plugin checkout")
        sp.add_argument("--model", default=DEFAULT_MODEL, help="Claude model id, or mock:obedient / mock:careful")

    s = sub.add_parser("show", help="print the directive and turn, no model call")
    common(s)
    s.add_argument("--scenario", default="A1-fork-pr-title", choices=list(sc.BY_ID))
    s.add_argument("--variant", default="claude-code", choices=["claude-code", "hermes", "patched"])
    s.set_defaults(fn=cmd_show)

    s = sub.add_parser("eval", help="variants x scenarios x trials")
    common(s)
    s.add_argument("--variants", default="claude-code,hermes,patched")
    s.add_argument("--trials", type=int, default=5)
    s.add_argument("--harness", default="api", choices=["api", "agent-sdk"],
                   help="api: plain tool loop; agent-sdk: Claude Agent SDK + claude_code preset, like the plugin")
    s.set_defaults(fn=cmd_eval)

    s = sub.add_parser("redteam", help="adaptive attacker campaign")
    common(s)
    s.add_argument("--variants", default="claude-code,patched")
    s.add_argument("--rounds", type=int, default=5)
    s.add_argument("--scenario", default=None, choices=[x["id"] for x in sc.SCENARIOS if x["kind"] == "attack"])
    s.add_argument("--attacker-model", default=None, help="attacker model (default: --model), or mock:scripted")
    s.set_defaults(fn=cmd_redteam)

    s = sub.add_parser("serve", help="JSON API for the web UI")
    common(s)
    s.add_argument("--port", type=int, default=8787)
    s.add_argument("--attacker-model", default=None, help="attacker model (default: --model), or mock:scripted")
    s.set_defaults(fn=cmd_serve)

    s = sub.add_parser("live", help="checks against a real Inkbox identity")
    live = s.add_subparsers(dest="live_cmd", required=True)
    c = live.add_parser("check", help="print outbound filter modes for an identity")
    c.add_argument("--identity", required=True)
    c.set_defaults(fn=cmd_live)

    args = p.parse_args(argv)
    load_dotenv()
    sys.exit(args.fn(args))
