import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  companySkills,
  createDb,
  documentRevisions,
  documents,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issueDocuments,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Global concurrency test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres global concurrency tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function ensureIssueRelationsTable(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "issue_relations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "company_id" uuid NOT NULL,
      "issue_id" uuid NOT NULL,
      "related_issue_id" uuid NOT NULL,
      "type" text NOT NULL,
      "created_by_agent_id" uuid,
      "created_by_user_id" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `));
}

describeEmbeddedPostgres("heartbeat global concurrency cap", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-global-cap-");
    db = createDb(tempDb.connectionString);
    await ensureIssueRelationsTable(db);
  }, 20_000);

  afterEach(async () => {
    mockAdapterExecute.mockReset();
    mockAdapterExecute.mockImplementation(async () => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      errorMessage: null,
      summary: "Global concurrency test run.",
      provider: "test",
      model: "test-model",
    }));
    runningProcesses.clear();
    // wait for in-flight runs to drain before wiping tables
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const runs = await db
        .select({ status: heartbeatRuns.status })
        .from(heartbeatRuns);
      const hasActiveRun = runs.some((run) => run.status === "queued" || run.status === "running");
      if (!hasActiveRun) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await db.delete(companySkills);
    await db.delete(issueComments);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndAgent(opts: { agentName?: string; maxConcurrentRuns?: number } = {}) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: opts.agentName ?? "ClaudeCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          wakeOnDemand: true,
          maxConcurrentRuns: opts.maxConcurrentRuns ?? 1,
        },
      },
      permissions: {},
    });
    return { companyId, agentId };
  }

  async function seedQueuedRun(input: {
    companyId: string;
    agentId: string;
    issueId: string;
  }) {
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();
    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      companyId: input.companyId,
      agentId: input.agentId,
      source: "automation",
      triggerDetail: "system",
      reason: "test",
      payload: { issueId: input.issueId },
      status: "queued",
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: input.companyId,
      agentId: input.agentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "queued",
      wakeupRequestId,
      contextSnapshot: { issueId: input.issueId, wakeReason: "test" },
    });
    await db
      .update(agentWakeupRequests)
      .set({ runId })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));
    return { runId, wakeupRequestId };
  }

  it("does not start more runs than maxGlobalConcurrentRuns across agents", async () => {
    heartbeat = heartbeatService(db, { maxGlobalConcurrentRuns: 2 });

    let releaseRuns!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRuns = resolve;
    });
    mockAdapterExecute.mockImplementation(async () => {
      await gate;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        errorMessage: null,
        summary: "done",
        provider: "test",
        model: "test-model",
      };
    });

    const seeds = await Promise.all([
      seedCompanyAndAgent({ agentName: "A1", maxConcurrentRuns: 5 }),
      seedCompanyAndAgent({ agentName: "A2", maxConcurrentRuns: 5 }),
      seedCompanyAndAgent({ agentName: "A3", maxConcurrentRuns: 5 }),
    ]);
    for (const seed of seeds) {
      const issueId = randomUUID();
      await db.insert(issues).values({
        id: issueId,
        companyId: seed.companyId,
        title: "work",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: seed.agentId,
      });
      await seedQueuedRun({
        companyId: seed.companyId,
        agentId: seed.agentId,
        issueId,
      });
    }

    await heartbeat.resumeQueuedRuns();
    await new Promise((resolve) => setTimeout(resolve, 250));

    const running = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "running"));
    expect(running.length).toBeLessThanOrEqual(2);
    expect(running.length).toBeGreaterThan(0);

    releaseRuns();
  });

  it("holds the cap under CONCURRENT wakes for different agents (read-then-claim race)", async () => {
    heartbeat = heartbeatService(db, { maxGlobalConcurrentRuns: 2 });

    let releaseRuns!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRuns = resolve;
    });
    mockAdapterExecute.mockImplementation(async () => {
      await gate;
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        errorMessage: null,
        summary: "done",
        provider: "test",
        model: "test-model",
      };
    });

    const seeds = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        seedCompanyAndAgent({ agentName: `R${i}`, maxConcurrentRuns: 5 }),
      ),
    );
    const issueIds: string[] = [];
    for (const seed of seeds) {
      const issueId = randomUUID();
      issueIds.push(issueId);
      await db.insert(issues).values({
        id: issueId,
        companyId: seed.companyId,
        title: "concurrent work",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: seed.agentId,
      });
    }

    // Fire all wakes concurrently — each wake claims at the end of enqueueWakeup,
    // so 5 claim sections race against the global count.
    await Promise.all(
      seeds.map((seed, i) =>
        heartbeat.wakeup(seed.agentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "race_test",
          payload: { issueId: issueIds[i] },
          contextSnapshot: { issueId: issueIds[i] },
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    const running = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "running"));
    expect(running.length).toBeLessThanOrEqual(2);
    expect(running.length).toBeGreaterThan(0);

    releaseRuns();
  });
});
