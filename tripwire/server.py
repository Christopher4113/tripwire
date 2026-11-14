"""aiohttp JSON API for the web UI. No auth, no database: localhost demo only."""

from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict
from pathlib import Path

from aiohttp import web

from . import scenarios as sc
from .cli import RUNS
from .directives import VARIANT_LABELS, directives, render
from .plugin_prompt import load
from .redteam import campaign
from .target import run_case
from .tools import load_tools


@web.middleware
async def cors(request, handler):
    resp = web.Response(status=204) if request.method == "OPTIONS" else await handler(request)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "content-type"
    return resp


def latest_matrix() -> dict | None:
    files = sorted(RUNS.glob("eval-*/results.json"))
    if not files:
        return None
    data = json.loads(files[-1].read_text())
    cells: dict = defaultdict(lambda: {"hits": 0, "n": 0, "errors": 0})
    for r in data["results"]:
        c = cells[f"{r['scenario']}|{r['variant']}"]
        c["hits"] += r["verdict"]["label"] in ("compromised", "pass")
        c["n"] += 1
        c["errors"] += bool(r.get("error"))
    return {"run": files[-1].parent.name, "model": data["model"], "trials": data["trials"],
            "variants": data["variants"], "cells": cells}


def make_app(plugin_dir: str, hermes_dir: str | None, model: str, attacker_model: str | None = None) -> web.Application:
    plugin = load(plugin_dir, hermes_dir)
    tools = load_tools(plugin_dir)
    temps = directives(plugin)

    def _model(body: dict) -> str:
        m = body.get("model") or model
        if not m.startswith("mock:") and not os.environ.get("ANTHROPIC_API_KEY"):
            raise web.HTTPBadRequest(text=json.dumps({"error": "ANTHROPIC_API_KEY is not set on the server. "
                                                      "Export it, or pick a mock model."}),
                                     content_type="application/json")
        return m

    async def body_of(request) -> dict:
        body = await request.json()
        if body.get("scenario") not in sc.BY_ID or body.get("variant") not in temps:
            raise web.HTTPBadRequest(text=json.dumps({"error": "unknown scenario or variant"}),
                                     content_type="application/json")
        return body

    async def scenarios(_):
        out = []
        for s in sc.SCENARIOS:
            _, turn, _ = plugin.build_turn(s["payload"])
            out.append({**s, "turn": turn, "attacker_text": sc.attacker_text(s)})
        return web.json_response(out)

    async def variants(_):
        return web.json_response({
            "model": model,
            "has_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "attacker_model": attacker_model or model,
            "variants": [{"id": k, "label": VARIANT_LABELS[k], "directive": render(t)} for k, t in temps.items()],
        })

    async def run(request):
        body = await body_of(request)
        m = _model(body)
        result = await asyncio.to_thread(run_case, plugin, tools, sc.get(body["scenario"]), temps[body["variant"]], m)
        return web.json_response({**result, "variant": body["variant"]})

    async def redteam(request):
        body = await body_of(request)
        m = _model(body)
        if sc.BY_ID[body["scenario"]]["kind"] != "attack":
            raise web.HTTPBadRequest(text=json.dumps({"error": "red-team needs an attack scenario"}),
                                     content_type="application/json")
        resp = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache",
                                           "Access-Control-Allow-Origin": "*"})
        await resp.prepare(request)
        gen = campaign(plugin, tools, body["scenario"], temps[body["variant"]],
                       min(int(body.get("rounds", 5)), 10), m, attacker_model)
        while (r := await asyncio.to_thread(next, gen, None)) is not None:
            await resp.write(f"data: {json.dumps(r, default=str)}\n\n".encode())
        await resp.write(b"event: end\ndata: {}\n\n")
        return resp

    async def results(_):
        return web.json_response(latest_matrix())

    app = web.Application(middlewares=[cors])
    app.add_routes([
        web.get("/api/scenarios", scenarios),
        web.get("/api/variants", variants),
        web.post("/api/run", run),
        web.post("/api/redteam", redteam),
        web.get("/api/results/latest", results),
        web.options("/{tail:.*}", lambda r: web.Response(status=204)),
    ])
    return app


def serve(plugin_dir: str, hermes_dir: str | None, model: str, port: int = 8787, attacker_model: str | None = None) -> None:
    print(f"tripwire API on http://127.0.0.1:{port}  (model {model}, plugin {Path(plugin_dir).resolve()})")
    web.run_app(make_app(plugin_dir, hermes_dir, model, attacker_model), host="127.0.0.1", port=port, print=None)
