import { Mail, MessageSquare, Phone, Search, UserRound } from "lucide-react";
import { OUTBOUND, recipients, type Kind, type RunResult, type ToolCall, type Verdict } from "@/lib/api";

// Icons name the channel the agent used (call, text, email, contact lookup), nothing decorative.
const ICON: Record<string, typeof Phone> = {
  inkbox_place_call: Phone,
  inkbox_send_sms: MessageSquare,
  inkbox_send_imessage: MessageSquare,
  inkbox_send_email: Mail,
  inkbox_lookup_contact: Search,
  inkbox_list_contacts: Search,
  inkbox_get_contact: UserRound,
  inkbox_whoami: UserRound,
};
const VERB: Record<string, string> = {
  inkbox_place_call: "Called",
  inkbox_send_sms: "Texted",
  inkbox_send_imessage: "iMessaged",
  inkbox_send_email: "Emailed",
};

function message(c: ToolCall): string {
  const i = c.input;
  return String(i.purpose ?? i.opening_message ?? i.text ?? i.body ?? i.subject ?? "");
}

function Call({ c, verdict, i }: { c: ToolCall; verdict: Verdict; i: number }) {
  const Icon = ICON[c.name] ?? Search;
  const out = OUTBOUND.has(c.name);
  const rec = recipients(c);
  const bad = rec.some((r) => verdict.untrusted.includes(r));
  const tone = !out ? "border-border" : bad ? "border-danger/60 bg-danger-soft" : "border-safe/50 bg-safe-soft";
  const ink = !out ? "text-muted-foreground" : bad ? "text-danger" : "text-safe";
  return (
    <li className={`land rounded-md border px-3 py-2.5 ${tone}`} style={{ animationDelay: `${i * 140}ms` }}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${ink}`} strokeWidth={2} />
        <div className="min-w-0 flex-1">
          {out ? (
            <p className="text-[15px]">
              <span className="font-semibold">{VERB[c.name]}</span>{" "}
              <span className={`font-mono text-base font-semibold ${ink}`}>{rec.join(", ") || "(no recipient)"}</span>
              <span className={`ml-2 text-xs ${ink}`}>{bad ? "not a saved contact" : "saved contact"}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{c.name}</span>{" "}
              {Object.entries(c.input)
                .filter(([, v]) => v !== "" && v != null)
                .map(([k, v]) => `${k}=${String(v)}`)
                .join(" ")}
            </p>
          )}
          {out && message(c) && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">“{message(c)}”</p>}
        </div>
      </div>
    </li>
  );
}

const BADGE = {
  compromised: { text: "COMPROMISED", cls: "bg-danger text-[#2a0f0c]" },
  safe: { text: "SAFE", cls: "bg-safe text-[#0b2a1b]" },
  pass: { text: "REACHED ON-CALL", cls: "bg-safe text-[#0b2a1b]" },
  fail: { text: "FAILED", cls: "bg-danger text-[#2a0f0c]" },
} as const;

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const b = BADGE[verdict.label];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`rounded-md px-3 py-1.5 font-heading text-2xl font-bold tracking-wide ${b.cls}`}>{b.text}</span>
      <span className="text-sm text-muted-foreground">{verdict.detail}</span>
    </div>
  );
}

export function Timeline({ result, kind }: { result: RunResult; kind: Kind }) {
  return (
    <div className="space-y-4">
      <VerdictBadge verdict={result.verdict} />
      {result.tool_calls.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          No tool calls. The agent {kind === "attack" ? "ignored the request" : "did not escalate"}.
        </p>
      ) : (
        <ol className="space-y-2" aria-label="Tool calls in order">
          {result.tool_calls.map((c, i) => (
            <Call key={i} c={c} verdict={result.verdict} i={i} />
          ))}
        </ol>
      )}
      {result.error && <p className="text-sm text-danger">API error: {result.error}</p>}
      {result.final_text && (
        <details className="text-sm text-muted-foreground">
          <summary className="w-fit rounded-sm">Agent&apos;s final text (not delivered to anyone)</summary>
          <p className="mt-2 whitespace-pre-wrap">{result.final_text}</p>
        </details>
      )}
      <p className="font-mono text-xs text-muted-foreground">model {result.model} · fake Inkbox tools, nothing was sent</p>
    </div>
  );
}
