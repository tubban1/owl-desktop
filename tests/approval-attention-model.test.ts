import { describe, expect, it } from "vitest";
import { pendingApprovals } from "../src/approvals/ApprovalAttention";

describe("pendingApprovals", () => {
  it("returns only pending Runtime approvals with user-facing fields", () => {
    expect(
      pendingApprovals({
        approvals: [
          {
            id: "approval_1",
            subjectType: "action",
            subject: "git.push",
            fingerprint: "abc",
            riskLevel: "high",
            sideEffects: ["remote repository mutation"],
            state: "pending",
            requestedAt: "2026-10-02T06:00:00.000Z",
            expiresAt: "2026-10-02T06:10:00.000Z",
            ownerTaskId: "task_1",
            ownerStepId: "push",
            reason: "git.push requires exact approval",
          },
          {
            id: "approval_2",
            subjectType: "action",
            subject: "fs.delete",
            riskLevel: "high",
            sideEffects: ["delete"],
            state: "consumed",
            requestedAt: "2026-10-02T05:00:00.000Z",
            expiresAt: "2026-10-02T05:10:00.000Z",
            reason: "already consumed",
          },
        ],
      }),
    ).toEqual([
      {
        id: "approval_1",
        subject: "git.push",
        subjectType: "action",
        riskLevel: "high",
        reason: "git.push requires exact approval",
        sideEffects: ["remote repository mutation"],
        taskId: "task_1",
        stepId: "push",
        expiresAt: "2026-10-02T06:10:00.000Z",
      },
    ]);
  });

  it("accepts array-shaped approval lists and ignores malformed rows", () => {
    expect(
      pendingApprovals([
        null,
        { state: "pending", subject: "missing id" },
        {
          approvalId: "approval_3",
          state: "pending",
          subject: "skill.publish",
          subjectType: "skill",
          riskLevel: "medium",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "approval_3",
        subject: "skill.publish",
        subjectType: "skill",
        riskLevel: "medium",
      }),
    ]);
  });
});
