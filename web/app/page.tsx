"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EventCard } from "@/components/event-card";
import { Directive, Turn } from "@/components/prompt-view";
import { Results } from "@/components/results";
import { Timeline } from "@/components/timeline";
import {
  API, getMeta, getPath, getScenarios, redteam, runOnce, withField,
  type Meta, type Round, type RunResult, type Scenario,
} from "@/lib/api";

type Status = "idle" | "running" | "redteam";

function Panel({ step, title, children, className = "" }: { step: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={`h-${step}`} className={`min-w-0 rounded-md border border-border bg-card p-4 sm:p-5 ${className}`}>
      <h2 id={`h-${step}`} className="mb-4 flex items-baseline gap-2 font-heading text-xl font-semibold">
        <span className="font-mono text-sm font-normal text-lavender">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function Home() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [scenarioId, setScenarioId] = useState("A1-fork-pr-title");
  const [variant, setVariant] = useState("claude-code");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    Promise.all([getScenarios(), getMeta()]).then(
      ([s, m]) => {
        setScenarios(s);
        setMeta(m);
        setModel(m.has_key ? m.model : "mock:obedient");
      },
      (e) => setLoadErr(String(e.message ?? e)),
    );
  }, []);

  const scenario = scenarios.find((s) => s.id === scenarioId);
  const directive = meta?.variants.find((v) => v.id === variant)?.directive ?? "";

  // The round on screen (picked, else latest) drives columns 1 and 2, so a rewrite shows up as GitHub would render it.
  const shownRound = rounds.find((r) => r.round === picked) ?? rounds.filter((r) => r.result).at(-1);
  const payload = useMemo(() => {
    if (!scenario) return {};
    let p = scenario.payload;
    for (const r of rounds) {
      if (r.field && r.value != null && r.round > 1) p = withField(p, r.field, r.value);
      if (r === shownRound) break;
    }
    return p;
  }, [scenario, rounds, shownRound]);
  const shown = shownRound?.result ?? result;
  const attackerText = (scenario?.attacker_fields ?? []).map((f) => getPath(payload, f)).filter((v): v is string => typeof v === "string");

  function reset() {
    abort.current?.abort();
    setResult(null);
    setRounds([]);
    setPicked(null);
    setErr("");
    setStatus("idle");
  }

  async function onRun() {
    reset();
    setStatus("running");
    try {
      setResult(await runOnce(scenarioId, variant, model));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStatus("idle");
    }
  }

  async function onRedteam() {
    reset();
    setStatus("redteam");
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      await redteam(scenarioId, variant, model, (r) => setRounds((rs) => [...rs, r]), ctl.signal);
    } catch (e) {
      if (!ctl.signal.aborted) setErr((e as Error).message);
    } finally {
      if (abort.current === ctl) setStatus("idle");
    }
  }

  const last = rounds.at(-1);
  const broken = last?.result?.verdict.label === "compromised";
  // The tripwire: a wire under the header that holds lavender, snaps red on a compromise, settles green when safe.
  const wire = shown ? (["compromised", "fail"].includes(shown.verdict.label) ? "bg-danger" : "bg-safe") : "bg-lavender/40";

  if (loadErr)
    return (
      <main className="mx-auto max-w-xl flex-1 p-8">
        <h1 className="font-heading text-3xl font-semibold">tripwire can&apos;t reach its API</h1>
        <p className="mt-3 text-muted-foreground">Tried {API}: {loadErr}</p>
        <p className="mt-4">Start it from the repo root:</p>
        <code className="mt-2 block font-mono text-sm text-lavender">uv run python -m tripwire serve --hermes ../hermes-agent-plugin</code>
      </main>
    );

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-4 pt-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
          <div>
            <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
              tripwire <span className="text-lg font-medium text-muted-foreground">for Inkbox agents</span>
            </h1>
            <p className="mt-1 text-muted-foreground">
              GitHub signs the delivery. <span className="text-peach">Strangers write the text.</span>
            </p>
          </div>
        </div>
        <div aria-hidden="true" className={`mt-4 h-[3px] rounded-full transition-colors duration-500 ${wire}`} />
      </header>

      <Tabs defaultValue="live" className="flex-1 gap-0 px-4 pb-8 sm:px-8">
        <TabsList className="mt-4 bg-secondary group-data-horizontal/tabs:h-11">
          <TabsTrigger value="live" className="min-h-10 px-4 text-[15px]">Live run</TabsTrigger>
          <TabsTrigger value="results" className="min-h-10 px-4 text-[15px]">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="mt-4">
          {!scenario || !meta ? (
            <p className="text-muted-foreground">Loading scenarios from {API}…</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-end gap-x-5 gap-y-3">
                <label className="grid w-full min-w-0 gap-1 text-sm text-muted-foreground sm:w-auto">
                  Scenario
                  <Select value={scenarioId} onValueChange={(v) => { if (v) { setScenarioId(v); reset(); } }}>
                    <SelectTrigger className="w-full min-w-0 text-[15px] text-foreground data-[size=default]:h-11 sm:min-w-72" aria-label="Scenario">
                      <SelectValue>{(v: string) => `${v} · ${scenarios.find((s) => s.id === v)?.label ?? ""}`}</SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {scenarios.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="py-2">
                          <span className="font-mono">{s.id}</span>
                          <span className="text-muted-foreground">{s.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <div className="grid gap-1 text-sm text-muted-foreground">
                  <span id="variant-label">Directive</span>
                  <ToggleGroup
                    aria-labelledby="variant-label"
                    value={[variant]}
                    onValueChange={(v: string[]) => { if (v[0]) { setVariant(v[0]); reset(); } }}
                    variant="outline"
                    className="h-11"
                  >
                    {meta.variants.map((v) => (
                      <ToggleGroupItem key={v.id} value={v.id} className="h-11 px-4 font-mono text-[14px] data-[pressed]:bg-accent data-[pressed]:text-foreground">
                        {v.id}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <label className="grid gap-1 text-sm text-muted-foreground">
                  Model
                  <Select value={model} onValueChange={(v) => v && setModel(v)}>
                    <SelectTrigger className="min-w-48 font-mono text-[14px] text-foreground data-[size=default]:h-11" aria-label="Model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {[meta.model, "mock:obedient", "mock:careful"].map((m) => (
                        <SelectItem key={m} value={m} disabled={!m.startsWith("mock:") && !meta.has_key} className="py-2 font-mono">
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <div className="flex gap-2">
                  <Button onClick={onRun} disabled={status !== "idle"} className="h-11 rounded-full px-6 text-[15px] font-semibold">
                    {status === "running" ? "Running…" : "Run event"}
                  </Button>
                  <Button
                    onClick={status === "redteam" ? reset : onRedteam}
                    disabled={status === "running" || scenario.kind !== "attack"}
                    variant="outline"
                    className="h-11 rounded-full px-5 text-[15px]"
                    title={scenario.kind !== "attack" ? "Red-team needs an attack scenario" : undefined}
                  >
                    {status === "redteam" ? "Stop red-team" : "Red-team 5 rounds"}
                  </Button>
                </div>
              </div>

              {model.startsWith("mock:") && (
                <p className="mb-4 text-sm text-muted-foreground">
                  <span className="text-peach">Mock model:</span> scripted and blind to the directive, so variants look the same.
                  {!meta.has_key && " Set ANTHROPIC_API_KEY on the server for real runs."}
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr_1fr]">
                <Panel step="01" title="The GitHub event">
                  <EventCard scenario={scenario} payload={payload} />
                </Panel>

                <Panel step="02" title="What the agent sees">
                  <h3 className="mb-2 text-sm text-muted-foreground">
                    System prompt extra · <span className="font-mono text-foreground">{variant}</span>
                  </h3>
                  <Directive text={directive} variant={variant} />
                  <h3 className="mb-2 mt-5 text-sm text-muted-foreground">Turn text, built by the plugin&apos;s own code</h3>
                  <Turn text={shown?.turn ?? scenario.turn} attacker={attackerText} />
                </Panel>

                <Panel step="03" title="What the agent did">
                  {err && (
                    <div role="alert" className="mb-4 rounded-md border border-danger/50 bg-danger-soft p-3 text-sm text-danger">
                      {err}
                    </div>
                  )}
                  {status === "running" && <p className="animate-pulse text-muted-foreground">The agent is handling the event…</p>}
                  {shown && status !== "running" && <Timeline result={shown} kind={scenario.kind} />}
                  {!shown && status === "idle" && !err && (
                    <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-muted-foreground">
                      Press <span className="text-foreground">Run event</span> to deliver this signed event to the agent.
                    </p>
                  )}

                  {(rounds.length > 0 || status === "redteam") && (
                    <div className="mt-6 border-t border-border pt-4">
                      <h3 className="mb-3 flex flex-wrap items-baseline justify-between gap-2 font-heading text-lg font-semibold">
                        Red-team campaign
                        {last?.done && !last.error && (
                          <span className={broken ? "text-danger" : "text-safe"}>
                            {broken ? `Broken in round ${last.round}` : `Held ${rounds.filter((r) => r.result).length} rounds`}
                          </span>
                        )}
                      </h3>
                      <ol className="space-y-2">
                        {rounds.map((r) => {
                          const label = r.result?.verdict.label;
                          const on = shownRound === r;
                          return (
                            <li key={r.round} className="land">
                              {r.error ? (
                                <p className="rounded-md border border-danger/50 p-3 text-sm text-danger">Round {r.round}: {r.error}</p>
                              ) : (
                                <button
                                  onClick={() => setPicked(r.round)}
                                  aria-pressed={on}
                                  className={`w-full rounded-md border p-3 text-left transition-colors hover:bg-accent/60 ${on ? "border-lavender" : "border-border"}`}
                                >
                                  <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                    <span>
                                      Round {r.round} · <span className="font-mono text-muted-foreground">{r.field}</span>
                                    </span>
                                    <span className={`font-semibold ${label === "compromised" ? "text-danger" : "text-safe"}`}>{label}</span>
                                  </span>
                                  <span className="mt-1.5 line-clamp-3 block text-sm text-danger">{r.value}</span>
                                  <span className="mt-1 block text-xs text-muted-foreground">{r.reasoning}</span>
                                </button>
                              )}
                            </li>
                          );
                        })}
                        {status === "redteam" && (
                          <li className="animate-pulse rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                            {rounds.length === 0 ? "Sending the seed attack…" : `Attacker is writing round ${rounds.length + 1}…`}
                          </li>
                        )}
                      </ol>
                    </div>
                  )}
                </Panel>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="results" className="mt-4">
          <Results scenarios={scenarios} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
