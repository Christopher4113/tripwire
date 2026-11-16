"use client";

import { useEffect, useState } from "react";
import { getLatest, type Matrix, type Scenario } from "@/lib/api";

const pct = (h: number, n: number) => (n ? h / n : 0);

function Scatter({ m, scenarios }: { m: Matrix; scenarios: Scenario[] }) {
  const pts = m.variants.map((v) => {
    const sum = (kind: string) =>
      scenarios.filter((s) => s.kind === kind).reduce(
        (a, s) => {
          const c = m.cells[`${s.id}|${v}`] ?? { hits: 0, n: 0 };
          return [a[0] + c.hits, a[1] + c.n];
        },
        [0, 0],
      );
    const [ah, an] = sum("attack");
    const [bh, bn] = sum("benign");
    // Scatter keeps the original axes: attack scenarios vs the B1 legit escalation.
    return { v, x: pct(ah, an), y: pct(bh, bn), label: `${ah}/${an} attacks · ${bh}/${bn} legit` };
  });
  const W = 420, H = 300, P = 48;
  const X = (x: number) => P + x * (W - P * 1.5);
  const Y = (y: number) => H - P - y * (H - P * 1.6);
  return (
    <figure className="rounded-md border border-border bg-card p-4">
      <figcaption className="mb-2 font-heading text-lg font-semibold">Attacks landed vs legit escalation</figcaption>
      <p className="mb-3 text-sm text-muted-foreground">Top-left is the goal: every real page goes out, no stranger gets through.</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[520px]" role="img" aria-label="Scatter of attack success against legit escalation per variant">
        {[0, 0.5, 1].map((t) => (
          <g key={t} className="text-[11px]" fill="var(--muted-foreground)">
            <line x1={X(t)} x2={X(t)} y1={Y(0)} y2={Y(1)} stroke="var(--border)" />
            <line x1={X(0)} x2={X(1)} y1={Y(t)} y2={Y(t)} stroke="var(--border)" />
            <text x={X(t)} y={Y(0) + 16} textAnchor="middle">{t * 100}%</text>
            <text x={X(0) - 8} y={Y(t) + 4} textAnchor="end">{t * 100}%</text>
          </g>
        ))}
        <text x={(X(0) + X(1)) / 2} y={H - 6} textAnchor="middle" fill="var(--muted-foreground)" className="text-[12px]">attacks landed</text>
        <text transform={`translate(12 ${(Y(0) + Y(1)) / 2}) rotate(-90)`} textAnchor="middle" fill="var(--muted-foreground)" className="text-[12px]">legit escalation</text>
        {pts.map((p, i) => (
          <g key={p.v}>
            <title>{`${p.v}: ${p.label}`}</title>
            <circle cx={X(p.x)} cy={Y(p.y)} r={7} fill={p.x > 0 ? "var(--danger)" : "var(--safe)"} stroke="var(--card)" strokeWidth={2} />
            <text x={X(p.x) + (p.x > 0.7 ? -12 : 12)} y={Y(p.y) + 4 + i * 14 - (pts.length - 1) * 7} textAnchor={p.x > 0.7 ? "end" : "start"} fill="var(--foreground)" className="text-[13px] font-semibold">
              {p.v}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export function Results({ scenarios }: { scenarios: Scenario[] }) {
  const [m, setM] = useState<Matrix | null | undefined>(undefined);
  const [err, setErr] = useState("");
  useEffect(() => {
    getLatest().then(setM, (e) => setErr(String(e.message ?? e)));
  }, []);

  if (err) return <p className="rounded-md border border-danger/50 p-4 text-danger">Could not load results: {err}</p>;
  if (m === undefined) return <p className="p-4 text-muted-foreground">Loading the latest eval run…</p>;
  if (m === null)
    return (
      <div className="rounded-md border border-dashed border-border p-6">
        <p className="font-heading text-lg font-semibold">No eval run yet</p>
        <p className="mt-1 text-muted-foreground">Run this, then reopen the tab:</p>
        <code className="mt-3 block font-mono text-sm text-lavender">uv run python -m tripwire eval --hermes ../hermes-agent-plugin --trials 5</code>
      </div>
    );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Run <span className="font-mono">{m.run}</span> · model <span className="font-mono">{m.model}</span> · {m.trials} trials per cell
      </p>
      <div className="grid gap-6 xl:grid-cols-[1fr_auto]">
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[560px] border-separate border-spacing-[2px] text-sm">
            <caption className="p-4 text-left font-heading text-lg font-semibold">Outcome by scenario and directive</caption>
            <thead>
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-normal text-muted-foreground">scenario</th>
                {m.variants.map((v) => (
                  <th key={v} scope="col" className="px-3 py-2 text-left font-mono font-normal">{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className="px-3 py-3 text-left font-mono font-normal">
                    {s.id}
                    <span className="block font-sans text-xs text-muted-foreground">{s.kind === "benign" ? "legit, should reach Priya" : s.kind === "mixed" ? "legit + attack: Priya only" : "attack, should not land"}</span>
                  </th>
                  {m.variants.map((v) => {
                    const c = m.cells[`${s.id}|${v}`] ?? { hits: 0, n: 0, errors: 0 };
                    const r = pct(c.hits, c.n);
                    // One hue per meaning: red intensity = attacks landed, green intensity = legit success.
                    const color = s.kind === "attack" ? "255 122 107" : "116 217 166";
                    const word = s.kind === "attack" ? "compromised" : s.kind === "mixed" ? `passed · ${c.comp ?? 0} compromised` : "reached on-call";
                    return (
                      <td key={v} title={`${s.id} on ${v}: ${c.hits}/${c.n} ${word}${c.errors ? `, ${c.errors} API errors` : ""}`}
                        className="rounded-sm px-3 py-3" style={{ background: `rgb(${color} / ${0.08 + r * 0.4})` }}>
                        <span className="font-heading text-xl font-semibold">{c.hits}/{c.n}</span>
                        <span className="block text-xs text-foreground/90">{word}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Scatter m={m} scenarios={scenarios} />
      </div>
    </div>
  );
}
