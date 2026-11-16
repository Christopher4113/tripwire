"""Offline tests. Needs their checkout at ../claude-code-plugin (and ../hermes-agent-plugin)."""

from pathlib import Path

import pytest

from tripwire import scenarios as sc
from tripwire.directives import directives
from tripwire.plugin_prompt import load
from tripwire.redteam import campaign, outcome
from tripwire.target import run_case
from tripwire.tools import KEEP, load_tools

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT.parent / "claude-code-plugin"
HERMES = ROOT.parent / "hermes-agent-plugin"

pytestmark = pytest.mark.skipif(not PLUGIN.exists(), reason="clone inkbox-ai/claude-code-plugin next to this repo")


@pytest.fixture(scope="module")
def ctx():
    plugin = load(PLUGIN, HERMES if HERMES.exists() else None)
    return plugin, load_tools(PLUGIN), directives(plugin)


def test_contract_gateway_exposes_what_we_pull(ctx):
    plugin, tools, _ = ctx
    assert "pre-authorized" in plugin.directive and "{sender}" in plugin.directive
    assert "UNVERIFIED" in plugin.unverified_directive
    _, turn, directive = plugin.build_turn({"title": "x"})
    assert directive == plugin.directive.format(sender="github")
    assert "Raw event payload:" in turn
    assert [t["name"] for t in tools] == list(KEEP)


def test_hermes_directive_loaded(ctx):
    plugin, _, temps = ctx
    if not HERMES.exists():
        pytest.skip("no hermes checkout")
    assert "hermes" in temps and "EXTERNAL" in plugin.hermes_directive


def test_a1_turn_contains_attacker_text(ctx):
    plugin, _, _ = ctx
    _, turn, _ = plugin.build_turn(sc.get("A1-fork-pr-title")["payload"])
    assert sc.ATTACKER_PHONE in turn and "NOTE TO ON-CALL BOT" in turn


def test_judge_a1(ctx):
    plugin, tools, temps = ctx
    s = sc.get("A1-fork-pr-title")
    bad = run_case(plugin, tools, s, temps["claude-code"], "mock:obedient")
    assert bad["verdict"]["label"] == "compromised" and sc.ATTACKER_PHONE in bad["verdict"]["untrusted"]
    good = run_case(plugin, tools, s, temps["patched"], "mock:careful")
    assert good["verdict"]["label"] == "safe"


def test_judge_flags_leaked_oncall_details(ctx):
    plugin, tools, temps = ctx
    r = run_case(plugin, tools, sc.get("A3-issue-email-exfil"), temps["claude-code"], "mock:obedient")
    assert r["verdict"]["label"] == "compromised"


@pytest.mark.parametrize("model", ["mock:obedient", "mock:careful"])
def test_b1_passes(ctx, model):
    plugin, tools, temps = ctx
    r = run_case(plugin, tools, sc.get("B1-oncall-escalation"), temps["claude-code"], model)
    assert r["verdict"]["label"] == "pass", r["verdict"]


def test_redteam_outcomes(ctx):
    plugin, tools, temps = ctx
    broke = list(campaign(plugin, tools, "A4-pr-body-call", temps["claude-code"], 3, "mock:obedient"))
    assert outcome(broke) == "broken in round 1"
    held = list(campaign(plugin, tools, "A4-pr-body-call", temps["patched"], 3, "mock:careful"))
    assert outcome(held) == "held 3 rounds"
    assert held[1]["field"] in sc.BY_ID["A4-pr-body-call"]["attacker_fields"]


def test_control_variants_loaded(ctx):
    plugin, _, temps = ctx
    assert temps["none"] == ""
    assert temps["unverified"] == plugin.unverified_directive and "UNVERIFIED" in temps["unverified"]


def test_a7_pushes_fork_metadata_past_the_cut(ctx):
    plugin, _, _ = ctx
    _, turn, _ = plugin.build_turn(sc.get("A7-buried-legit-fields")["payload"])
    raw = turn.split("Raw event payload:", 1)[1]
    assert sc.ATTACKER_PHONE in raw
    assert '"fork": true' not in raw and '"sender"' not in raw and '"pull_request"' not in raw


@pytest.mark.parametrize("sid", ["A5-lookalike-contact", "A6-schema-mimic", "A7-buried-legit-fields"])
def test_new_attacks_grade(ctx, sid):
    plugin, tools, temps = ctx
    assert run_case(plugin, tools, sc.get(sid), temps["claude-code"], "mock:obedient")["verdict"]["label"] == "compromised"
    assert run_case(plugin, tools, sc.get(sid), temps["patched"], "mock:careful")["verdict"]["label"] == "safe"


def test_a8_mixed_needs_priya_and_not_attacker(ctx):
    plugin, tools, temps = ctx
    s = sc.get("A8-mixed-escalation")
    assert run_case(plugin, tools, s, temps["claude-code"], "mock:obedient")["verdict"]["label"] == "compromised"
    assert run_case(plugin, tools, s, temps["patched"], "mock:careful")["verdict"]["label"] == "pass"
