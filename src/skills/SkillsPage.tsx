import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FlaskConical,
  Library,
  PackagePlus,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import type {
  SkillCandidateInspection,
  SkillCandidateRecord,
  SkillManagerSnapshot,
  SkillSummary,
  UserSkillManifest,
  UserSkillRegistrySummary,
  WorkflowSkillDiscoveryResult,
  WorkflowSkillProposal,
} from "../types";
import {
  desktopSkillManagerPort,
  type SkillManagerPort,
} from "./skillManagerPort";

type SkillTab =
  | "overview"
  | "installed"
  | "discover"
  | "candidates"
  | "library";

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

function currentCandidateManifest(
  candidate: SkillCandidateRecord,
): UserSkillManifest | null {
  const revision = candidate.revisions.find(
    (item) => item.digest === candidate.currentDigest,
  );
  const manifest = revision?.manifest;
  return manifest && typeof manifest === "object"
    ? (manifest as UserSkillManifest)
    : null;
}

function lastCurrentTest(candidate: SkillCandidateRecord) {
  return [...candidate.tests]
    .reverse()
    .find((test) => test.candidateDigest === candidate.currentDigest);
}

function UserSkillLifecycle({
  registry,
  port,
  onChanged,
}: {
  registry: UserSkillRegistrySummary;
  port: SkillManagerPort;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const action = async (name: string, operation: () => Promise<unknown>) => {
    setBusy(name);
    setError("");
    try {
      await operation();
      await onChanged();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="skill-lifecycle">
      <div>
        <span className="eyebrow">RUNTIME REGISTRY</span>
        <strong>Version & activation management</strong>
      </div>

      <div className="skill-lifecycle-actions">
        <button
          className="secondary"
          disabled={Boolean(busy)}
          onClick={() =>
            void action("toggle", () =>
              port.setUserSkillEnabled(registry.skillId, !registry.enabled),
            )
          }
        >
          <Zap size={14} />
          {registry.enabled ? "Disable" : "Enable"}
        </button>

        <button
          className="secondary"
          disabled={Boolean(busy) || registry.versions.length < 2}
          onClick={() =>
            void action("rollback", () => port.rollbackUserSkill(registry.skillId))
          }
        >
          <RotateCcw size={14} />
          Roll Back
        </button>

        <button
          className="secondary danger-text"
          disabled={Boolean(busy)}
          onClick={() => {
            if (
              window.confirm(
                `Uninstall all versions of ${registry.skillId}? Historical Runtime evidence remains governed separately.`,
              )
            ) {
              void action("uninstall", () =>
                port.uninstallUserSkill(registry.skillId),
              );
            }
          }}
        >
          <Trash2 size={14} />
          Uninstall
        </button>
      </div>

      <div className="skill-version-list">
        {registry.versions.map((version) => (
          <div key={version.version}>
            <div>
              <code>{version.version}</code>
              <span>
                {version.active ? "active" : version.uninstalledAt ? "uninstalled" : "installed"}
              </span>
            </div>
            {!version.active && !version.uninstalledAt && (
              <button
                className="text-button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void action("activate", () =>
                    port.activateUserSkillVersion(
                      registry.skillId,
                      version.version,
                    ),
                  )
                }
              >
                Activate
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <div className="skill-run-error">{error}</div>}
      <small>Runtime owns immutable versions, activation history and execution truth.</small>
    </div>
  );
}

function SkillDetail({
  skill,
  registry,
  port,
  onChanged,
}: {
  skill: SkillSummary;
  registry?: UserSkillRegistrySummary;
  port: SkillManagerPort;
  onChanged: () => Promise<void>;
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
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="panel skill-detail">
      <div className="skill-detail-head">
        <div>
          <span className="eyebrow">
            {skill.source === "user" ? "USER SKILL" : "BUILT-IN SKILL"}
          </span>
          <h2>{skill.title}</h2>
          <code>{skill.id}</code>
        </div>
        <div className="skill-pill-row">
          <Pill tone={availabilityTone(skill.availability)}>
            {skill.availability === "ready"
              ? "ready"
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

      {skill.source === "user" && registry ? (
        <UserSkillLifecycle
          registry={registry}
          port={port}
          onChanged={onChanged}
        />
      ) : (
        <div className="contract-note">
          <ShieldCheck size={17} />
          <div>
            <strong>Built-in Skill lifecycle follows Runtime releases.</strong>
            <p>
              Desktop can inspect and run this Skill, but it does not mutate
              built-in Runtime capability definitions.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function ProposalDetail({
  proposal,
  port,
  onCandidateCreated,
}: {
  proposal: WorkflowSkillProposal;
  port: SkillManagerPort;
  onCandidateCreated: (candidateId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");

  const createCandidate = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const receipt = await port.submitCandidate(proposal.manifest);
      setResult(receipt);
      await onCandidateCreated(receipt.candidate.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel skill-discovery-detail">
      <div className="skill-detail-head">
        <div>
          <span className="eyebrow">REPEATED WORKFLOW</span>
          <h2>{proposal.manifest.title}</h2>
          <code>{proposal.proposalId}</code>
        </div>
        <div className="skill-pill-row">
          <Pill tone={proposal.validation.valid ? "good" : "danger"}>
            {proposal.validation.valid ? "validation ready" : "validation failed"}
          </Pill>
          <Pill
            tone={
              proposal.governance.state === "new"
                ? "good"
                : proposal.governance.state === "installed"
                  ? "neutral"
                  : "warn"
            }
          >
            {proposal.governance.state.replaceAll("_", " ")}
          </Pill>
        </div>
      </div>

      <p className="skill-description">{proposal.manifest.description}</p>

      <div className="skill-facts discovery-evidence-grid">
        <div><span>Successful runs</span><strong>{proposal.support.successfulRuns}</strong></div>
        <div><span>Evidence used</span><strong>{proposal.support.sourceRunsUsed}</strong></div>
        <div><span>Argument sets</span><strong>{proposal.support.distinctArgumentSets}</strong></div>
        <div><span>Recovery-free</span><strong>{proposal.support.recoveryFreeRuns}</strong></div>
        <div><span>Inputs inferred</span><strong>{proposal.parameterization.inputNames.length}</strong></div>
        <div><span>Risk</span><strong>{proposal.manifest.contract.riskLevel}</strong></div>
      </div>

      <div className="skill-detail-grid">
        <div>
          <span className="eyebrow">INFERRED INPUTS</span>
          <div className="skill-chip-list">
            {proposal.parameterization.inputNames.length
              ? proposal.parameterization.inputNames.map((name) => (
                  <code key={name}>{name}</code>
                ))
              : <span className="muted">No varying scalar inputs detected</span>}
          </div>
        </div>
        <div>
          <span className="eyebrow">VARIABLE PATHS</span>
          <div className="skill-chip-list">
            {proposal.parameterization.variablePaths.length
              ? proposal.parameterization.variablePaths.map((value) => (
                  <code key={value}>{value}</code>
                ))
              : <span className="muted">Stable workflow</span>}
          </div>
        </div>
      </div>

      <div className="candidate-validation">
        <div className="panel-heading">
          <div><span className="eyebrow">VALIDATION PREVIEW</span><h3>Runtime deterministic report</h3></div>
          <Pill tone={proposal.validation.valid ? "good" : "danger"}>
            {proposal.validation.errors.length} errors · {proposal.validation.warnings.length} warnings
          </Pill>
        </div>
        {proposal.validation.errors.map((issue) => (
          <div className="candidate-issue error" key={issue.code + issue.path}>
            <code>{issue.code}</code>
            <span>{issue.path}</span>
            <p>{issue.message}</p>
          </div>
        ))}
        {proposal.validation.warnings.map((issue) => (
          <div className="candidate-issue warning" key={issue.code + issue.path}>
            <code>{issue.code}</code>
            <span>{issue.path}</span>
            <p>{issue.message}</p>
          </div>
        ))}
        {proposal.validation.errors.length === 0 &&
          proposal.validation.warnings.length === 0 && (
            <div className="candidate-valid-line">
              <CheckCircle2 size={15} />
              Draft passes Runtime validation preview.
            </div>
          )}
      </div>

      <details className="skill-manifest-review">
        <summary>Review draft manifest and provenance</summary>
        <pre className="code-block tall">{pretty(proposal.manifest)}</pre>
      </details>

      <div className="candidate-action-bar">
        <button
          className="primary"
          disabled={busy || !proposal.readyForSubmit}
          onClick={() => void createCandidate()}
          title={
            proposal.readyForSubmit
              ? "Write this exact manifest into the Runtime Candidate Store"
              : `Runtime governance state: ${proposal.governance.state}`
          }
        >
          <PackagePlus size={15} />
          {busy ? "Creating…" : "Create Candidate"}
        </button>
        <span>
          This is the first write boundary. Discovery itself remains read-only.
        </span>
      </div>

      {proposal.governance.evidenceRefreshAvailable && (
        <div className="skill-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>New evidence is available.</strong>
            <p>
              Runtime found an existing Candidate for this workflow, but the
              current draft digest changed. Desktop will not auto-revise it.
            </p>
          </div>
        </div>
      )}

      {error && <div className="skill-run-error">{error}</div>}
      {result !== null && (
        <details className="skill-result-details">
          <summary>Candidate submission receipt</summary>
          <pre className="code-block">{pretty(result)}</pre>
        </details>
      )}
    </section>
  );
}

function CandidateDetail({
  candidate,
  port,
  onChanged,
}: {
  candidate: SkillCandidateRecord;
  port: SkillManagerPort;
  onChanged: () => Promise<void>;
}) {
  const manifest = currentCandidateManifest(candidate);
  const latestTest = lastCurrentTest(candidate);
  const [inputsText, setInputsText] = useState("{}");
  const [inspection, setInspection] = useState<SkillCandidateInspection | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    setInspection(null);
    setResult(null);
    setError("");
    setInputsText("{}");
  }, [candidate.id, candidate.currentDigest]);

  const action = async (name: string, operation: () => Promise<unknown>) => {
    setBusy(name);
    setError("");
    setResult(null);
    try {
      const output = await operation();
      setResult(output);
      await onChanged();
      return output;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    } finally {
      setBusy("");
    }
  };

  const parseInputs = () => {
    const value = JSON.parse(inputsText || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Test inputs must be a JSON object.");
    }
    return value as Record<string, unknown>;
  };

  const compileTest = async () => {
    let inputs: Record<string, unknown>;
    try {
      inputs = parseInputs();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return;
    }
    await action("compile", () =>
      port.compileCandidateTest(candidate.id, candidate.currentDigest, inputs),
    );
  };

  const inspect = async () => {
    setBusy("inspect");
    setError("");
    try {
      const output = await port.inspectCandidate(
        candidate.id,
        latestTest?.taskId,
      );
      setInspection(output);
      setResult(output);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy("");
    }
  };

  const promote = async () => {
    const testTaskId = inspection?.test?.binding.taskId ?? latestTest?.taskId;
    if (!testTaskId) {
      setError("Compile and run a Candidate test before promotion.");
      return;
    }
    if (
      !window.confirm(
        `Promote ${manifest?.id ?? candidate.id}?\n\nThis installs an immutable User Skill version into the canonical Runtime Registry. Runtime will independently re-check validation, M2 evidence, quality, privacy and verification gates.`,
      )
    ) {
      return;
    }
    const output = await action("promote", () =>
      port.promoteCandidate(
        candidate.id,
        candidate.currentDigest,
        testTaskId,
        true,
      ),
    );
    if (output) {
      setInspection(
        await port.inspectCandidate(candidate.id, testTaskId).catch(() => inspection),
      );
    }
  };

  const active = candidate.status === "active";

  return (
    <section className="panel skill-candidate-detail">
      <div className="skill-detail-head">
        <div>
          <span className="eyebrow">RUNTIME CANDIDATE</span>
          <h2>{manifest?.title ?? candidate.id}</h2>
          <code>{candidate.id}</code>
        </div>
        <div className="skill-pill-row">
          <Pill
            tone={
              candidate.status === "promoted"
                ? "good"
                : candidate.status === "dismissed"
                  ? "neutral"
                  : "warn"
            }
          >
            {candidate.status}
          </Pill>
          <Pill tone={candidate.validation?.valid ? "good" : "warn"}>
            revision {candidate.revision}
          </Pill>
        </div>
      </div>

      <div className="candidate-digest-row">
        <span>Current digest</span>
        <code>{candidate.currentDigest}</code>
      </div>

      {manifest && (
        <>
          <p className="skill-description">{manifest.description}</p>
          <div className="skill-facts">
            <div><span>Skill ID</span><strong>{manifest.id}</strong></div>
            <div><span>Version</span><strong>{manifest.version}</strong></div>
            <div><span>Risk</span><strong>{manifest.contract.riskLevel}</strong></div>
            <div><span>Steps</span><strong>{manifest.steps.length}</strong></div>
            <div><span>Inputs</span><strong>{Object.keys(manifest.inputs).length}</strong></div>
            <div><span>Tests bound</span><strong>{candidate.tests.length}</strong></div>
          </div>
        </>
      )}

      <div className="candidate-stepper">
        <div className={candidate.validation?.valid ? "done" : "current"}>
          <span>1</span><strong>Validate</strong>
        </div>
        <div className={latestTest ? "done" : candidate.validation?.valid ? "current" : ""}>
          <span>2</span><strong>Compile Test</strong>
        </div>
        <div className={inspection?.test ? "done" : latestTest ? "current" : ""}>
          <span>3</span><strong>Run + Inspect</strong>
        </div>
        <div className={candidate.status === "promoted" ? "done" : inspection?.readiness.promotable ? "current" : ""}>
          <span>4</span><strong>Promote</strong>
        </div>
      </div>

      <div className="candidate-actions">
        <button
          className="secondary"
          disabled={Boolean(busy) || !active}
          onClick={() =>
            void action("validate", () =>
              port.validateCandidate(candidate.id, candidate.currentDigest),
            )
          }
        >
          <CheckCircle2 size={15} />
          {busy === "validate" ? "Validating…" : "Validate"}
        </button>

        <button
          className="secondary"
          disabled={Boolean(busy) || !active || candidate.validation?.valid !== true}
          onClick={() => void compileTest()}
        >
          <FlaskConical size={15} />
          {busy === "compile" ? "Compiling…" : "Compile Test"}
        </button>

        <button
          className="secondary"
          disabled={Boolean(busy) || !latestTest}
          onClick={() =>
            latestTest &&
            void action("run", () => port.runCandidateTest(latestTest.taskId))
          }
        >
          <Play size={15} />
          {busy === "run" ? "Running…" : "Run Test"}
        </button>

        <button
          className="secondary"
          disabled={Boolean(busy)}
          onClick={() => void inspect()}
        >
          <Eye size={15} />
          {busy === "inspect" ? "Inspecting…" : "Inspect"}
        </button>

        <button
          className="primary"
          disabled={
            Boolean(busy) ||
            candidate.status !== "active" ||
            inspection?.readiness.promotable !== true
          }
          onClick={() => void promote()}
        >
          <PackagePlus size={15} />
          {busy === "promote" ? "Promoting…" : "Promote"}
        </button>

        <button
          className="secondary danger-text"
          disabled={Boolean(busy) || candidate.status !== "active"}
          onClick={() => {
            if (window.confirm("Dismiss this exact Candidate revision?")) {
              void action("dismiss", () =>
                port.dismissCandidate(candidate.id, candidate.currentDigest),
              );
            }
          }}
        >
          Dismiss
        </button>
      </div>

      <div className="skill-run-box">
        <div className="skill-run-heading">
          <div>
            <span className="eyebrow">TEST INPUTS</span>
            <strong>Candidate fixture values</strong>
          </div>
          <span>JSON object</span>
        </div>
        <textarea
          value={inputsText}
          onChange={(event) => setInputsText(event.target.value)}
          spellCheck={false}
          disabled={!active}
        />
        {latestTest && (
          <div className="candidate-test-binding">
            <span>Current digest test task</span>
            <code>{latestTest.taskId}</code>
          </div>
        )}
      </div>

      {candidate.validation && (
        <div className="candidate-validation">
          <div className="panel-heading">
            <div><span className="eyebrow">VALIDATION</span><h3>Machine-readable report</h3></div>
            <Pill tone={candidate.validation.valid ? "good" : "danger"}>
              {candidate.validation.valid ? "PASS" : "FAIL"}
            </Pill>
          </div>
          {candidate.validation.errors.map((issue) => (
            <div className="candidate-issue error" key={issue.code + issue.path}>
              <code>{issue.code}</code><span>{issue.path}</span><p>{issue.message}</p>
            </div>
          ))}
          {candidate.validation.warnings.map((issue) => (
            <div className="candidate-issue warning" key={issue.code + issue.path}>
              <code>{issue.code}</code><span>{issue.path}</span><p>{issue.message}</p>
            </div>
          ))}
        </div>
      )}

      {inspection && (
        <div className="candidate-readiness">
          <div>
            {inspection.readiness.promotable
              ? <CheckCircle2 size={18} />
              : <AlertTriangle size={18} />}
            <div>
              <strong>
                {inspection.readiness.promotable
                  ? "Promotion gates ready"
                  : "Not promotable yet"}
              </strong>
              <span>
                {inspection.readiness.reasons.length
                  ? inspection.readiness.reasons.join(" · ")
                  : "Validation, test, M2, quality, privacy and verification gates passed."}
              </span>
            </div>
          </div>
        </div>
      )}

      {manifest && (
        <details className="skill-manifest-review">
          <summary>Review current manifest</summary>
          <pre className="code-block tall">{pretty(manifest)}</pre>
        </details>
      )}

      {error && <div className="skill-run-error">{error}</div>}
      {result !== null && (
        <details className="skill-result-details">
          <summary>Latest Runtime receipt</summary>
          <pre className="code-block tall">{pretty(result)}</pre>
        </details>
      )}

      <div className="contract-note">
        <ShieldCheck size={17} />
        <div>
          <strong>Desktop does not decide PASS or promotion readiness.</strong>
          <p>
            Validate, test evidence, M2 provenance, privacy, quality and promotion
            are all re-checked by Runtime against the exact Candidate digest.
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

  const [discovery, setDiscovery] =
    useState<WorkflowSkillDiscoveryResult | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState("");
  const [discoveryBusy, setDiscoveryBusy] = useState(false);

  const [selectedCandidateId, setSelectedCandidateId] = useState("");

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
      if (
        next.candidates.length &&
        !next.candidates.some((candidate) => candidate.id === selectedCandidateId)
      ) {
        setSelectedCandidateId(next.candidates[0].id);
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

  const discover = async () => {
    setDiscoveryBusy(true);
    setError("");
    try {
      const result = await port.discover({
        minSuccessfulRuns: 3,
        scanLimit: 500,
        limit: 50,
        includeBlocked: true,
      });
      setDiscovery(result);
      if (result.proposals.length) {
        setSelectedProposalId((current) =>
          result.proposals.some((proposal) => proposal.proposalId === current)
            ? current
            : result.proposals[0].proposalId,
        );
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setDiscoveryBusy(false);
    }
  };

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
  const selectedRegistry = selected
    ? snapshot?.userSkills.find((skill) => skill.skillId === selected.id)
    : undefined;

  const selectedProposal =
    discovery?.proposals.find(
      (proposal) => proposal.proposalId === selectedProposalId,
    ) ?? null;

  const selectedCandidate =
    snapshot?.candidates.find(
      (candidate) => candidate.id === selectedCandidateId,
    ) ?? null;

  const registrySupported = snapshot?.lifecycle.registrySupported === true;
  const discoverySupported = snapshot?.lifecycle.discoverySupported === true;

  const openCandidate = async (candidateId: string) => {
    await refresh();
    setSelectedCandidateId(candidateId);
    setTab("candidates");
  };

  return (
    <>
      <div className="section-header">
        <div>
          <h1>Skills</h1>
          <p>
            Discover repeated verified work, review evidence, test governed
            Candidates, then explicitly promote immutable User Skills.
          </p>
        </div>
        <div className="skill-header-actions">
          <button
            className="secondary"
            disabled={!discoverySupported}
            onClick={() => {
              setTab("discover");
              if (!discovery) void discover();
            }}
            title={
              discoverySupported
                ? "Scan verified M2 workflow evidence"
                : "Requires Runtime workflowSkillDiscovery v1"
            }
          >
            <Search size={15} /> Discover
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
          ["discover", "Discover"],
          ["candidates", "Candidates"],
          ["library", "Library"],
        ] as Array<[SkillTab, string]>).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "candidates" && (snapshot?.summary.candidates ?? 0) > 0
              ? <span className="skill-tab-count">{snapshot?.summary.candidates}</span>
              : null}
          </button>
        ))}
      </div>

      {error && <div className="skill-page-error">{error}</div>}

      {tab === "overview" && (
        <>
          <div className="skill-metrics">
            <div><strong>{snapshot?.summary.installed ?? "—"}</strong><span>Installed / built-in</span></div>
            <div><strong>{snapshot?.summary.ready ?? "—"}</strong><span>Runtime-ready</span></div>
            <div><strong>{snapshot?.summary.needsAttention ?? "—"}</strong><span>Needs attention</span></div>
            <div><strong>{snapshot?.summary.candidates ?? "—"}</strong><span>Active Candidates</span></div>
            <div><strong>{snapshot?.userSkills.length ?? "—"}</strong><span>User Skills</span></div>
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
                <div><span className="eyebrow">SKILL GOVERNANCE</span><h3>Runtime extensions</h3></div>
              </div>
              <div className="skill-provider-list">
                <div>
                  {registrySupported ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                  <p><strong>User Skill Registry</strong><small>Candidate + immutable version lifecycle</small></p>
                  <Pill tone={registrySupported ? "good" : "warn"}>
                    {registrySupported ? "available" : "not supported"}
                  </Pill>
                </div>
                <div>
                  {discoverySupported ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                  <p><strong>Workflow Discovery</strong><small>Read-only repeated-work proposals from M2</small></p>
                  <Pill tone={discoverySupported ? "good" : "warn"}>
                    {discoverySupported ? "available" : "not supported"}
                  </Pill>
                </div>
              </div>
            </section>
          </div>

          <div className="skill-promotion-pipeline">
            <span>Repeated work</span>
            <b>→</b>
            <span>Review</span>
            <b>→</b>
            <span>Candidate</span>
            <b>→</b>
            <span>Test Task</span>
            <b>→</b>
            <span>M2 Evidence</span>
            <b>→</b>
            <span>Promote</span>
          </div>

          <div className="contract-note">
            <Sparkles size={17} />
            <div>
              <strong>Discovery can be automatic; trust promotion is not.</strong>
              <p>
                Runtime may detect a reusable workflow and draft a manifest.
                Candidate creation and production promotion remain explicit,
                digest-bound governance actions.
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
            <SkillDetail
              skill={selected}
              registry={selectedRegistry}
              port={port}
              onChanged={refresh}
            />
          ) : (
            <section className="panel"><div className="empty">Select a Skill.</div></section>
          )}
        </div>
      )}

      {tab === "discover" && (
        <>
          {!discoverySupported ? (
            <section className="panel skill-empty-state">
              <Search size={30} />
              <h2>Workflow discovery is not available on this Runtime</h2>
              <p>
                Built-in Skills remain usable. Repeated-work discovery requires
                the additive Runtime workflowSkillDiscovery v1 extension.
              </p>
              <Pill tone="warn">Feature-detected, never emulated by Desktop</Pill>
            </section>
          ) : (
            <>
              <div className="skill-discovery-toolbar panel">
                <div>
                  <span className="eyebrow">M2 WORKFLOW DISCOVERY</span>
                  <strong>Find repeated verified procedures</strong>
                  <small>Default threshold: at least 3 independently completed runs.</small>
                </div>
                <button
                  className="primary"
                  disabled={discoveryBusy}
                  onClick={() => void discover()}
                >
                  <Search size={15} />
                  {discoveryBusy ? "Scanning…" : "Scan verified work"}
                </button>
              </div>

              {discovery && (
                <div className="skill-metrics">
                  <div><strong>{discovery.scannedEpisodes}</strong><span>M2 episodes scanned</span></div>
                  <div><strong>{discovery.eligibleRuns}</strong><span>Eligible runs</span></div>
                  <div><strong>{discovery.repeatedGroups}</strong><span>Repeated groups</span></div>
                  <div><strong>{discovery.proposalCount}</strong><span>Proposals</span></div>
                  <div><strong>{discovery.blocked?.length ?? 0}</strong><span>Blocked patterns</span></div>
                </div>
              )}

              {discovery && discovery.proposals.length > 0 ? (
                <div className="skill-browser">
                  <section className="panel skill-list-panel">
                    <div className="panel-heading">
                      <div><span className="eyebrow">OPPORTUNITIES</span><h3>Repeated workflows</h3></div>
                    </div>
                    <div className="skill-list">
                      {discovery.proposals.map((proposal) => (
                        <button
                          key={proposal.proposalId}
                          className={
                            selectedProposalId === proposal.proposalId ? "active" : ""
                          }
                          onClick={() => setSelectedProposalId(proposal.proposalId)}
                        >
                          <span className={"skill-state-dot " + (proposal.readyForSubmit ? "ready" : "needs_attention")} />
                          <div>
                            <strong>{proposal.manifest.title}</strong>
                            <small>
                              {proposal.support.successfulRuns} runs · {proposal.parameterization.inputNames.length} inputs
                            </small>
                          </div>
                          <Pill tone={proposal.readyForSubmit ? "good" : "warn"}>
                            {proposal.governance.state}
                          </Pill>
                        </button>
                      ))}
                    </div>
                  </section>
                  {selectedProposal && (
                    <ProposalDetail
                      proposal={selectedProposal}
                      port={port}
                      onCandidateCreated={openCandidate}
                    />
                  )}
                </div>
              ) : discovery ? (
                <section className="panel skill-empty-state">
                  <Sparkles size={30} />
                  <h2>No reusable workflow proposal yet</h2>
                  <p>
                    Runtime found no repeated completed Primitive workflow that
                    currently satisfies its evidence, verification and governance
                    threshold.
                  </p>
                  <Pill tone="neutral">One successful Task is never enough</Pill>
                </section>
              ) : (
                <section className="panel skill-empty-state">
                  <Search size={30} />
                  <h2>Scan your verified Runtime history</h2>
                  <p>
                    Discovery is read-only. It groups repeated successful M2
                    evidence and drafts a reviewable User Skill manifest without
                    writing the Candidate Store.
                  </p>
                </section>
              )}
            </>
          )}
        </>
      )}

      {tab === "candidates" && (
        <>
          {!registrySupported ? (
            <section className="panel skill-empty-state">
              <Sparkles size={30} />
              <h2>User Skill Registry is not available on this Runtime</h2>
              <p>
                Desktop will not maintain a mock executable Candidate Store.
                Upgrade to a Runtime exposing userSkillRegistry v1.
              </p>
              <Pill tone="warn">Canonical Runtime lifecycle required</Pill>
            </section>
          ) : snapshot && snapshot.candidates.length > 0 ? (
            <div className="skill-browser">
              <section className="panel skill-list-panel">
                <div className="panel-heading">
                  <div><span className="eyebrow">CANDIDATE STORE</span><h3>Governed drafts</h3></div>
                  <span className="neutral-pill">{snapshot.candidates.length}</span>
                </div>
                <div className="skill-list">
                  {snapshot.candidates.map((candidate) => {
                    const manifest = currentCandidateManifest(candidate);
                    return (
                      <button
                        key={candidate.id}
                        className={
                          selectedCandidateId === candidate.id ? "active" : ""
                        }
                        onClick={() => setSelectedCandidateId(candidate.id)}
                      >
                        <span
                          className={
                            "skill-state-dot " +
                            (candidate.status === "promoted"
                              ? "ready"
                              : candidate.status === "dismissed"
                                ? "disabled"
                                : candidate.validation?.valid
                                  ? "ready"
                                  : "needs_attention")
                          }
                        />
                        <div>
                          <strong>{manifest?.title ?? candidate.id}</strong>
                          <small>r{candidate.revision} · {candidate.status}</small>
                        </div>
                        <Pill
                          tone={
                            candidate.status === "promoted"
                              ? "good"
                              : candidate.status === "dismissed"
                                ? "neutral"
                                : "warn"
                          }
                        >
                          {candidate.validation?.valid ? "valid" : candidate.status}
                        </Pill>
                      </button>
                    );
                  })}
                </div>
              </section>
              {selectedCandidate && (
                <CandidateDetail
                  candidate={selectedCandidate}
                  port={port}
                  onChanged={refresh}
                />
              )}
            </div>
          ) : (
            <section className="panel skill-empty-state">
              <Sparkles size={30} />
              <h2>No active Skill Candidates</h2>
              <p>
                Run Discover to review repeated work, then explicitly create a
                Candidate. External/ChatGPT imports can use the same Runtime
                Candidate lifecycle.
              </p>
              <button
                className="secondary"
                disabled={!discoverySupported}
                onClick={() => setTab("discover")}
              >
                <Search size={15} />
                Discover repeated work
              </button>
            </section>
          )}
        </>
      )}

      {tab === "library" && (
        <section className="panel skill-empty-state">
          <Library size={30} />
          <h2>Cloud Skill Library comes later</h2>
          <p>
            Cloud may distribute immutable packages by digest, but every package
            must still be validated and installed by the local Runtime.
          </p>
          <Pill tone="neutral">Not required for local Skill governance</Pill>
        </section>
      )}
    </>
  );
}
