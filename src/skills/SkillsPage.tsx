import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Library,
  PackagePlus,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { SkillManagerSnapshot, SkillSummary } from "../types";
import {
  desktopSkillManagerPort,
  type SkillManagerPort,
} from "./skillManagerPort";

type SkillTab = "overview" | "installed" | "candidates" | "library";

const pretty = (value: unknown) => JSON.stringify(value ?? {}, null, 2);

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger";
}) {
  return <span className={"skill-pill " + tone}>{children}</span>;
}

function availabilityTone(
  value: SkillSummary["availability"],
): "good" | "warn" | "danger" | "neutral" {
  if (value === "ready") return "good";
  if (value === "integrity_failed" || value === "incompatible") return "danger";
  if (value === "disabled") return "neutral";
  return "warn";
}

function riskTone(
  value: string,
): "good" | "warn" | "danger" | "neutral" {
  if (value === "low") return "good";
  if (value === "medium") return "warn";
  if (value === "high" || value === "critical") return "danger";
  return "neutral";
}

function SkillDetail({
  skill,
  port,
}: {
  skill: SkillSummary;
  port: SkillManagerPort;
}) {
  const [argsText, setArgsText] = useState("{}");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<"dry" | "run" | null>(null);

  useEffect(() => {
    setArgsText("{}");
    setResult(null);
    setError("");
  }, [skill.id]);

  const parseArgs = () => {
    const parsed = JSON.parse(argsText || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Skill args must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  };

  const invoke = async (mode: "dry" | "run") => {
    setError("");
    setResult(null);
    let args: Record<string, unknown>;
    try {
      args = parseArgs();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return;
    }

    if (
      mode === "run" &&
      skill.sideEffects.length > 0 &&
      !window.confirm(
        `Run ${skill.id}?\n\nThis Skill declares side effects:\n- ${skill.sideEffects.join("\n- ")}\n\nRuntime policy and Approval still apply.`,
      )
    ) {
      return;
    }

    setBusyAction(mode);
    try {
      const output =
        mode === "dry"
          ? await port.dryRun(skill.id, args)
          : await port.run(skill.id, args);
      setResult(output);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="panel skill-detail">
      <div className="skill-detail-head">
        <div>
          <span className="eyebrow">BUILT-IN SKILL</span>
          <h2>{skill.title}</h2>
          <code>{skill.id}</code>
        </div>
        <div className="skill-pill-row">
          <Pill tone={availabilityTone(skill.availability)}>
            {skill.availability === "ready"
              ? "ABI ready"
              : skill.availability.replaceAll("_", " ")}
          </Pill>
          <Pill tone={riskTone(skill.riskLevel)}>
            {skill.riskLevel} risk
          </Pill>
        </div>
      </div>

      <p className="skill-description">{skill.description}</p>

      <div className="skill-facts">
        <div><span>Version</span><strong>{skill.version}</strong></div>
        <div><span>Execution</span><strong>{skill.executionMode}</strong></div>
        <div><span>Primitive ABI</span><strong>{skill.requiredPrimitiveAbi ?? "—"}</strong></div>
        <div><span>Idempotent</span><strong>{skill.idempotent ? "Yes" : "No"}</strong></div>
        <div><span>Verification</span><strong>{skill.requiresVerification ? "Required" : "Not required"}</strong></div>
        <div><span>Retry</span><strong>{skill.retryPolicy}</strong></div>
      </div>

      {skill.availabilityReasons.length > 0 && (
        <div className="skill-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>Needs attention</strong>
            {skill.availabilityReasons.map((reason) => <p key={reason}>{reason}</p>)}
          </div>
        </div>
      )}

      <div className="skill-detail-grid">
        <div>
          <span className="eyebrow">REQUIRED PRIMITIVES</span>
          <div className="skill-chip-list">
            {skill.requiredPrimitives.length
              ? skill.requiredPrimitives.map((primitive) => (
                  <code key={primitive}>{primitive}</code>
                ))
              : <span className="muted">None declared</span>}
          </div>
        </div>
        <div>
          <span className="eyebrow">SIDE EFFECTS</span>
          <div className="skill-chip-list">
            {skill.sideEffects.length
              ? skill.sideEffects.map((effect) => (
                  <code key={effect}>{effect}</code>
                ))
              : <span className="muted">No declared side effects</span>}
          </div>
        </div>
      </div>

      <div className="skill-input-contract">
        <span className="eyebrow">INPUT CONTRACT</span>
        {Object.keys(skill.inputs).length ? (
          <div className="skill-input-list">
            {Object.entries(skill.inputs).map(([name, description]) => (
              <div key={name}>
                <code>{name}</code>
                <span>{description}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">This Skill declares no inputs.</p>
        )}
      </div>

      <div className="skill-run-box">
        <div className="skill-run-heading">
          <div>
            <span className="eyebrow">TEST CONSOLE</span>
            <strong>Arguments</strong>
          </div>
          <span>JSON object</span>
        </div>
        <textarea
          value={argsText}
          onChange={(event) => setArgsText(event.target.value)}
          spellCheck={false}
        />
        <div className="skill-run-actions">
          <button
            className="secondary"
            disabled={busyAction !== null}
            onClick={() => void invoke("dry")}
          >
            <FlaskConical size={15} />
            {busyAction === "dry" ? "Dry Running…" : "Dry Run"}
          </button>
          <button
            className="primary"
            disabled={busyAction !== null || skill.availability !== "ready"}
            onClick={() => void invoke("run")}
          >
            <Play size={15} />
            {busyAction === "run" ? "Running…" : "Run"}
          </button>
          <span className="skill-runtime-authority">
            Runtime remains execution authority
          </span>
        </div>
        {error && <div className="skill-run-error">{error}</div>}
        {result !== null && <pre className="code-block tall">{pretty(result)}</pre>}
      </div>

      <div className="skill-lifecycle">
        <div>
          <span className="eyebrow">LIFECYCLE</span>
          <strong>Version & activation management</strong>
        </div>
        <div className="skill-lifecycle-actions">
          {["Disable", "Update", "Roll Back", "Uninstall"].map((action) => (
            <button
              key={action}
              className="secondary"
              disabled
              title={skill.lifecycle.reason}
            >
              {action}
            </button>
          ))}
        </div>
        <small>{skill.lifecycle.reason}</small>
      </div>

      <div className="contract-note">
        <ShieldCheck size={17} />
        <div>
          <strong>User Skill lifecycle is intentionally unavailable.</strong>
          <p>
            Install, enable/disable, update, rollback and uninstall require the
            canonical Runtime 1.x Skill Registry. Desktop will not fake these
            operations locally.
          </p>
        </div>
      </div>
    </section>
  );
}

export function SkillsPage({
  port = desktopSkillManagerPort,
}: {
  port?: SkillManagerPort;
}) {
  const [tab, setTab] = useState<SkillTab>("overview");
  const [snapshot, setSnapshot] = useState<SkillManagerSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await port.snapshot();
      setSnapshot(next);
      if (!selectedId && next.skills.length) {
        const preferred =
          next.skills.find((skill) => skill.id === "runtime.identity") ??
          next.skills[0];
        setSelectedId(preferred.id);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const visibleSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!snapshot) return [];
    if (!needle) return snapshot.skills;
    return snapshot.skills.filter((skill) =>
      [skill.id, skill.title, skill.domain, skill.description]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, snapshot]);

  const selected =
    snapshot?.skills.find((skill) => skill.id === selectedId) ?? null;

  return (
    <>
      <div className="section-header">
        <div>
          <h1>Skills</h1>
          <p>
            Runtime-backed reusable capabilities. Catalog and execution are real;
            lifecycle management stays pending until Runtime 1.x.
          </p>
        </div>
        <div className="skill-header-actions">
          <button
            className="secondary"
            disabled
            title="Requires Runtime 1.x Candidate + User Skill Registry API"
          >
            <PackagePlus size={15} /> Add Skill
          </button>
          <button className="primary" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw size={15} className={busy ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <div className="skill-tabs">
        {([
          ["overview", "Overview"],
          ["installed", "Installed"],
          ["candidates", "Candidates"],
          ["library", "Library"],
        ] as Array<[SkillTab, string]>).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="skill-page-error">{error}</div>}

      {tab === "overview" && (
        <>
          <div className="skill-metrics">
            <div><strong>{snapshot?.summary.installed ?? "—"}</strong><span>Installed / built-in</span></div>
            <div><strong>{snapshot?.summary.ready ?? "—"}</strong><span>ABI-ready</span></div>
            <div><strong>{snapshot?.summary.needsAttention ?? "—"}</strong><span>Needs attention</span></div>
            <div><strong>{snapshot?.summary.candidates ?? "—"}</strong><span>Candidates</span></div>
            <div><strong>{snapshot?.summary.updates ?? "—"}</strong><span>Updates</span></div>
          </div>

          <div className="two-col">
            <section className="panel">
              <div className="panel-heading">
                <div><span className="eyebrow">RUNTIME CATALOG</span><h3>Available Skills</h3></div>
                <Pill tone="good">{snapshot?.source ?? "connecting"}</Pill>
              </div>
              <div className="skill-overview-list">
                {snapshot?.skills.slice(0, 8).map((skill) => (
                  <button key={skill.id} onClick={() => { setSelectedId(skill.id); setTab("installed"); }}>
                    <span className={"skill-state-dot " + skill.availability} />
                    <div><strong>{skill.title}</strong><small>{skill.id}</small></div>
                    <Pill tone={riskTone(skill.riskLevel)}>{skill.riskLevel}</Pill>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div><span className="eyebrow">PROVIDERS</span><h3>Execution dependencies</h3></div>
              </div>
              <div className="skill-provider-list">
                {snapshot?.providers.map((provider) => (
                  <div key={provider.id}>
                    {provider.enabled && provider.available
                      ? <CheckCircle2 size={15} />
                      : <AlertTriangle size={15} />}
                    <p><strong>{provider.label}</strong><small>{provider.capabilities.join(" · ")}</small></p>
                    <Pill tone={provider.enabled && provider.available ? "good" : "warn"}>
                      {provider.enabled ? (provider.available ? "ready" : "unavailable") : "disabled"}
                    </Pill>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="contract-note">
            <Sparkles size={17} />
            <div>
              <strong>Skill Candidates are a post-1.0 capability.</strong>
              <p>
                OWL can later surface repeated verified workflows here, but one
                successful Task will never silently become an active Skill.
              </p>
            </div>
          </div>
        </>
      )}

      {tab === "installed" && (
        <div className="skill-browser">
          <section className="panel skill-list-panel">
            <div className="skill-search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Skills…"
              />
              <span>{visibleSkills.length} Skills</span>
            </div>
            <div className="skill-list">
              {visibleSkills.map((skill) => (
                <button
                  key={skill.id}
                  className={selectedId === skill.id ? "active" : ""}
                  onClick={() => setSelectedId(skill.id)}
                >
                  <span className={"skill-state-dot " + skill.availability} />
                  <div>
                    <strong>{skill.title}</strong>
                    <small>{skill.id} · v{skill.version}</small>
                  </div>
                  <Pill tone={riskTone(skill.riskLevel)}>{skill.riskLevel}</Pill>
                </button>
              ))}
            </div>
          </section>
          {selected ? (
            <SkillDetail skill={selected} port={port} />
          ) : (
            <section className="panel"><div className="empty">Select a Skill.</div></section>
          )}
        </div>
      )}

      {tab === "candidates" && (
        <section className="panel skill-candidate-stage">
          <div className="skill-candidate-hero">
            <Sparkles size={30} />
            <div>
              <h2>No canonical Skill candidates yet</h2>
              <p>
                Runtime 1.x will make this the evidence-backed promotion queue.
                M3 Semantic Memory remains reusable knowledge; it does not
                silently become an executable Skill.
              </p>
            </div>
            <Pill tone="warn">
              {snapshot?.lifecycle.reason ?? "Requires Runtime 1.x Skill Registry"}
            </Pill>
          </div>

          <div className="skill-candidate-sources">
            <div>
              <strong>ChatGPT import</strong>
              <span>Normalize or repair an external Skill with an LLM.</span>
            </div>
            <div>
              <strong>Desktop import</strong>
              <span>Submit a package, folder or repository for Runtime validation.</span>
            </div>
            <div>
              <strong>Repeated work</strong>
              <span>Propose a Candidate from recurring verified Tasks.</span>
            </div>
          </div>

          <div className="skill-promotion-pipeline">
            <span>Candidate</span>
            <b>→</b>
            <span>Validate</span>
            <b>→</b>
            <span>Test Task</span>
            <b>→</b>
            <span>M2 Evidence</span>
            <b>→</b>
            <span>Promotion Gate</span>
            <b>→</b>
            <span>User Skill Registry</span>
          </div>

          <div className="contract-note">
            <ShieldCheck size={17} />
            <div>
              <strong>Runtime decides if a Candidate is valid.</strong>
              <p>
                ChatGPT or an AI Worker may modify Candidate content after a
                machine-readable repair report. Desktop presents review,
                evidence and promotion controls; it does not embed a hidden LLM
                or write Runtime Registry state.
              </p>
            </div>
          </div>
        </section>
      )}

      {tab === "library" && (
        <section className="panel skill-empty-state">
          <Library size={30} />
          <h2>Cloud Skill Library comes later</h2>
          <p>
            Cloud may distribute immutable packages by digest, but every package
            must still be inspected and installed by the local Runtime.
          </p>
          <Pill tone="neutral">Not required for Desktop Phase A</Pill>
        </section>
      )}
    </>
  );
}
