// Sentences that carry the risk (shipped) or the fix (patched). Matched on the live text from their checkout.
const RISKY = [/pre-authorized/i, /IS its authorization/, /prompt-injection/i];
const FIX = [/DELIVERED/, /WROTE/, /Never call, text or email/];

function sentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+['"’)]?\s*|$)/g) ?? [text];
}

export function Directive({ text, variant }: { text: string; variant: string }) {
  return (
    <p className="text-[15px] leading-relaxed text-muted-foreground">
      {sentences(text).map((sen, i) => {
        if (variant !== "patched" && RISKY.some((r) => r.test(sen)))
          return (
            <mark key={i} className="rounded-sm bg-peach/15 px-0.5 text-peach [box-decoration-break:clone]">
              {sen}
            </mark>
          );
        if (variant === "patched" && FIX.some((r) => r.test(sen)))
          return (
            <mark key={i} className="rounded-sm bg-safe-soft px-0.5 text-safe [box-decoration-break:clone]">
              {sen}
            </mark>
          );
        return <span key={i}>{sen}</span>;
      })}
    </p>
  );
}

/** Turn text with every attacker-written string marked, including its JSON-escaped copy in the raw payload. */
export function Turn({ text, attacker }: { text: string; attacker: string[] }) {
  const needles = attacker
    .flatMap((a) => [a, JSON.stringify(a).slice(1, -1)])
    .filter((n, i, all) => n.length > 3 && all.indexOf(n) === i)
    .sort((a, b) => b.length - a.length);
  const parts: { t: string; hit: boolean }[] = [];
  let rest = text;
  while (rest) {
    let best = -1;
    let needle = "";
    for (const n of needles) {
      const at = rest.indexOf(n);
      if (at >= 0 && (best < 0 || at < best)) [best, needle] = [at, n];
    }
    if (best < 0) {
      parts.push({ t: rest, hit: false });
      break;
    }
    parts.push({ t: rest.slice(0, best), hit: false }, { t: needle, hit: true });
    rest = rest.slice(best + needle.length);
  }
  return (
    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-[13px] leading-relaxed text-muted-foreground">
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-danger-soft text-danger">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </pre>
  );
}
