import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Row => Boolean(item && typeof item === "object"),
    );
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of ["approvals", "items", "result"]) {
    const child = object[key];
    if (Array.isArray(child)) {
      return child.filter(
        (item): item is Row => Boolean(item && typeof item === "object"),
      );
    }
    if (key === "result" && child && typeof child === "object") {
      const nested = rows(child);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type PendingApproval = {
  id: string;
  subject: string;
  subjectType: string;
  riskLevel: string;
  reason: string | null;
  sideEffects: string[];
  taskId: string | null;
  stepId: string | null;
  expiresAt: string | null;
};

export function pendingApprovals(value: unknown): PendingApproval[] {
  return rows(value)
    .filter((row) => text(row.state)?.toLowerCase() === "pending")
    .map((row) => ({
      id: text(row.id) ?? text(row.approvalId) ?? "",
      subject: text(row.subject) ?? "Protected action",
      subjectType: text(row.subjectType) ?? "action",
      riskLevel: text(row.riskLevel) ?? "unknown",
      reason: text(row.reason),
      sideEffects: Array.isArray(row.sideEffects)
        ? row.sideEffects.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      taskId: text(row.ownerTaskId),
      stepId: text(row.ownerStepId),
      expiresAt: text(row.expiresAt),
    }))
    .filter((approval) => approval.id);
}

export function ApprovalAttention({
  approvals,
  onApprove,
  onDeny,
  compact = false,
}: {
  approvals: unknown;
  onApprove(approvalId: string): Promise<void>;
  onDeny(approvalId: string): Promise<void>;
  compact?: boolean;
}) {
  const pending = useMemo(() => pendingApprovals(approvals), [approvals]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (pending.length === 0) return null;

  const decide = async (
    approval: PendingApproval,
    decision: "approve" | "deny",
  ) => {
    if (
      decision === "approve" &&
      ["high", "critical"].includes(approval.riskLevel.toLowerCase()) &&
      !window.confirm(
        `Approve ${approval.riskLevel}-risk action “${approval.subject}”?\n\n${approval.reason ?? "Runtime requires explicit approval before the side effect can continue."}`,
      )
    ) {
      return;
    }

    setBusyId(approval.id);
    setError(null);
    try {
      if (decision === "approve") await onApprove(approval.id);
      else await onDeny(approval.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={"panel approval-attention " + (compact ? "compact" : "")}>
      <div className="approval-attention-head">
        <div className="approval-attention-icon">
          <ShieldCheck size={19} />
        </div>
        <div>
          <span className="eyebrow">NEEDS YOUR APPROVAL</span>
          <h3>
            {pending.length} protected action{pending.length === 1 ? "" : "s"} paused
          </h3>
          <p>
            Runtime has stopped before the side effect. Approving resumes only
            the exact fingerprinted action.
          </p>
        </div>
        <span className="neutral-pill warning-pill">{pending.length} pending</span>
      </div>

      {error && (
        <div className="inline-warning approval-error">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="approval-attention-list">
        {pending.map((approval) => (
          <article className="approval-attention-row" key={approval.id}>
            <div className="approval-copy">
              <div className="approval-title-row">
                <strong>{approval.subject}</strong>
                <span className={"approval-risk " + approval.riskLevel.toLowerCase()}>
                  {approval.riskLevel} risk
                </span>
              </div>
              <span>
                {approval.reason ??
                  "Runtime requires explicit approval before continuing."}
              </span>
              {approval.sideEffects.length > 0 && (
                <small>Side effects: {approval.sideEffects.join(" · ")}</small>
              )}
              <div className="approval-refs">
                {approval.taskId && <code>task {approval.taskId.slice(-10)}</code>}
                {approval.stepId && <code>step {approval.stepId}</code>}
                {approval.expiresAt && (
                  <code>
                    expires{" "}
                    {new Date(approval.expiresAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </code>
                )}
              </div>
            </div>
            <div className="approval-actions">
              <button
                className="secondary danger-text"
                disabled={busyId === approval.id}
                onClick={() => void decide(approval, "deny")}
              >
                <XCircle size={14} />
                Deny
              </button>
              <button
                className="primary"
                disabled={busyId === approval.id}
                onClick={() => void decide(approval, "approve")}
              >
                <CheckCircle2 size={14} />
                {busyId === approval.id ? "Applying…" : "Approve"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
