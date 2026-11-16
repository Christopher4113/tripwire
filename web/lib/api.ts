export const API = process.env.NEXT_PUBLIC_TRIPWIRE_API ?? "http://127.0.0.1:8787";

export type Kind = "benign" | "attack" | "mixed";
export type Payload = Record<string, unknown>;

export interface Scenario {
  id: string;
  kind: Kind;
  label: string;
  github_event: string;
  attacker_fields: string[];
  payload: Payload;
  turn: string;
}

export interface Variant {
  id: string;
  label: string;
  directive: string;
}

export interface Meta {
  model: string;
  has_key: boolean;
  variants: Variant[];
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
}

export interface Verdict {
  label: "compromised" | "safe" | "pass" | "fail";
  detail: string;
  untrusted: string[];
  known: string[];
}

export interface RunResult {
  model: string;
  scenario: string;
  turn: string;
  tool_calls: ToolCall[];
  final_text: string;
  error: string | null;
  verdict: Verdict;
}

export interface Round {
  round: number;
  field?: string;
  value?: string;
  reasoning?: string;
  result?: RunResult;
  error?: string;
  done: boolean;
}

export interface Matrix {
  run: string;
  model: string;
  trials: number;
  variants: string[];
  cells: Record<string, { hits: number; comp?: number; n: number; errors: number }>;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    let msg = body;
    try {
      msg = JSON.parse(body).error ?? body;
    } catch {}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

export const getScenarios = () => fetch(`${API}/api/scenarios`).then((r) => json<Scenario[]>(r));
export const getMeta = () => fetch(`${API}/api/variants`).then((r) => json<Meta>(r));
export const getLatest = () => fetch(`${API}/api/results/latest`).then((r) => json<Matrix | null>(r));

export const runOnce = (scenario: string, variant: string, model: string) =>
  fetch(`${API}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario, variant, model }),
  }).then((r) => json<RunResult>(r));

/** POST + read the server-sent event stream, one callback per round. */
export async function redteam(
  scenario: string,
  variant: string,
  model: string,
  onRound: (r: Round) => void,
  signal: AbortSignal,
) {
  const res = await fetch(`${API}/api/redteam`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario, variant, model, rounds: 5 }),
    signal,
  });
  if (!res.ok || !res.body) await json(res);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith("event: end")) return;
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) onRound(JSON.parse(line.slice(6)));
    }
  }
}

export function getPath(obj: Payload, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Payload)[k] : undefined), obj);
}

export function withField(obj: Payload, path: string, value: string): Payload {
  const copy = structuredClone(obj);
  const keys = path.split(".");
  let cur = copy;
  for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Payload;
  cur[keys.at(-1)!] = value;
  return copy;
}

export const OUTBOUND = new Set(["inkbox_send_email", "inkbox_send_sms", "inkbox_send_imessage", "inkbox_place_call"]);

export function recipients(c: ToolCall): string[] {
  const v = c.name === "inkbox_place_call" ? c.input.to_number : c.input.to;
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}
