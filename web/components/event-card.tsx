import { getPath, type Payload, type Scenario } from "@/lib/api";

const ASSOC: Record<string, string> = {
  NONE: "None",
  FIRST_TIME_CONTRIBUTOR: "First-time contributor",
  CONTRIBUTOR: "Contributor",
  MEMBER: "Member",
  OWNER: "Owner",
};

const s = (v: unknown) => (typeof v === "string" ? v : "");

function Avatar({ login }: { login: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-full bg-accent font-heading text-sm font-semibold text-lavender"
    >
      {login.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "danger" | "safe" }) {
  const cls = {
    muted: "border-border text-muted-foreground",
    danger: "border-danger/50 text-danger",
    safe: "border-safe/50 text-safe",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}

/** A field a stranger wrote. Red tint links it to the red recipient in the timeline. */
function Authored({ field, author, children, mono }: { field: string; author: string; children: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-danger/35 bg-danger-soft px-3 py-2">
      <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed ${mono ? "font-mono text-sm" : ""}`}>{children}</p>
      <p className="mt-1.5 text-xs text-danger">
        <span className="font-mono">{field}</span> · written by @{author}
      </p>
    </div>
  );
}

function Header({ login, assoc, children }: { login: string; assoc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Avatar login={login} />
      <span className="font-semibold">{login}</span>
      {assoc && <Pill tone={assoc === "NONE" || assoc === "FIRST_TIME_CONTRIBUTOR" ? "danger" : "muted"}>{ASSOC[assoc] ?? assoc}</Pill>}
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

export function EventCard({ scenario, payload }: { scenario: Scenario; payload: Payload }) {
  const repo = s(getPath(payload, "repository.full_name"));
  const sender = s(getPath(payload, "sender.login"));
  const ev = scenario.github_event;
  let body: React.ReactNode;

  if (ev === "workflow_run") {
    const wr = (payload.workflow_run ?? {}) as Payload;
    const fork = Boolean(getPath(wr, "head_repository.fork"));
    const operatorTitle = s(payload.title);
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Pill tone="danger">{s(wr.conclusion) || "failure"}</Pill>
          <span className="font-mono text-muted-foreground">{s(wr.name)}</span>
          <span className="text-muted-foreground">on {s(wr.event)}</span>
          {fork && <Pill tone="danger">fork · {s(getPath(wr, "head_repository.full_name"))}</Pill>}
        </div>
        {scenario.attacker_fields.includes("workflow_run.display_title") ? (
          <Authored field="workflow_run.display_title" author={sender}>{s(wr.display_title)}</Authored>
        ) : (
          <p className="text-[15px]">{s(wr.display_title)}</p>
        )}
        {scenario.attacker_fields.includes("workflow_run.head_commit.message") && (
          <Authored field="workflow_run.head_commit.message" author={sender} mono>
            {s(getPath(wr, "head_commit.message"))}
          </Authored>
        )}
        {operatorTitle && (
          <div className="rounded-md border border-safe/35 bg-safe-soft px-3 py-2 text-[15px] leading-relaxed">
            <p className="font-semibold">{operatorTitle}</p>
            <p className="mt-1 text-muted-foreground">{s(payload.summary)}</p>
            <p className="mt-2">{s(payload.requested_action)}</p>
            <p className="mt-1.5 text-xs text-safe">top-level fields · set by @{sender}, the operator&apos;s own CI</p>
          </div>
        )}
        <Header login={sender}>triggered this run</Header>
      </div>
    );
  } else if (ev === "issue_comment") {
    const c = (payload.comment ?? {}) as Payload;
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          on issue #{String(getPath(payload, "issue.number"))} · {s(getPath(payload, "issue.title"))}
        </p>
        <Header login={s(getPath(c, "user.login"))} assoc={s(c.author_association)}>commented</Header>
        <Authored field="comment.body" author={s(getPath(c, "user.login"))}>{s(c.body)}</Authored>
      </div>
    );
  } else {
    const key = ev === "issues" ? "issue" : "pull_request";
    const it = (payload[key] ?? {}) as Payload;
    const login = s(getPath(it, "user.login"));
    const fork = Boolean(getPath(it, "head.repo.fork"));
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Pill tone="safe">Open</Pill>
          <span className="text-muted-foreground">
            {key === "issue" ? "Issue" : "Pull request"} #{String(it.number)}
          </span>
          {fork && <Pill tone="danger">fork · {s(getPath(it, "head.repo.full_name"))}</Pill>}
        </div>
        <Authored field={`${key}.title`} author={login}>{s(it.title)}</Authored>
        <Header login={login} assoc={s(it.author_association)}>opened this</Header>
        <Authored field={`${key}.body`} author={login}>{s(it.body)}</Authored>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="font-mono text-sm">{repo}</p>
        <p className="font-mono text-xs text-muted-foreground">X-GitHub-Event: {ev}</p>
      </div>
      {body}
      <p className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-sm text-safe">
        <span aria-hidden="true">✓</span> Signed by GitHub (valid X-Hub-Signature-256)
      </p>
      {scenario.kind === "attack" && (
        <p className="mt-1 text-sm text-muted-foreground">The signature covers the delivery. The red text above is from a stranger.</p>
      )}
    </div>
  );
}
