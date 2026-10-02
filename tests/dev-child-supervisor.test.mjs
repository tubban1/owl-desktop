import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { DevChildSupervisor } from "../scripts/lib/dev-child-supervisor.mjs";

let nextPid = 1000;

class FakeChild extends EventEmitter {
  constructor(command) {
    super();
    this.command = command;
    this.pid = nextPid++;
    this.kills = [];
  }

  kill(signal) {
    this.kills.push(signal);
    return true;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("DevChildSupervisor fault-domain isolation", () => {
  it("restarts Connection Host without touching a healthy Runtime child", async () => {
    const launches = [];
    const fatals = [];
    const supervisor = new DevChildSupervisor({
      spawnImpl(command) {
        const child = new FakeChild(command);
        launches.push(child);
        return child;
      },
      logger: { warn() {}, error() {} },
      onFatal(code, meta) {
        fatals.push({ code, meta });
      },
    });

    const runtime = supervisor.start(
      "runtime",
      "/tmp",
      "runtime-command",
      [],
      {},
      { restartOnExit: false },
    );
    const host = supervisor.start(
      "connection-host",
      "/tmp",
      "host-command",
      [],
      {},
      { restartOnExit: true, restartDelayMs: 10 },
    );

    host.emit("exit", 1, null);
    await sleep(30);

    const hostLaunches = launches.filter(
      (child) => child.command === "host-command",
    );
    expect(hostLaunches).toHaveLength(2);
    expect(runtime.kills).toEqual([]);
    expect(fatals).toEqual([]);
    expect(supervisor.children.has(runtime)).toBe(true);
    expect(supervisor.children.has(hostLaunches[1])).toBe(true);

    supervisor.shutdown();
    expect(runtime.kills).toEqual(["SIGTERM"]);
    expect(hostLaunches[1].kills).toEqual(["SIGTERM"]);
  });

  it("respects an intentional clean Desktop exit when restart policy is on-failure", async () => {
    const launches = [];
    const infos = [];
    const fatals = [];
    const supervisor = new DevChildSupervisor({
      spawnImpl(command) {
        const child = new FakeChild(command);
        launches.push(child);
        return child;
      },
      logger: {
        warn() {},
        error() {},
        info(message) {
          infos.push(message);
        },
      },
      onFatal(code, meta) {
        fatals.push({ code, meta });
      },
    });

    const desktop = supervisor.start(
      "desktop",
      "/tmp",
      "desktop-command",
      [],
      {},
      { restartPolicy: "on-failure", restartDelayMs: 10 },
    );

    desktop.emit("exit", 0, null);
    await sleep(30);

    expect(launches).toHaveLength(1);
    expect(fatals).toEqual([]);
    expect(infos.some((message) => message.includes("exited cleanly"))).toBe(true);
    expect(supervisor.children.size).toBe(0);
  });

  it("restarts Desktop after an abnormal exit when restart policy is on-failure", async () => {
    const launches = [];
    const supervisor = new DevChildSupervisor({
      spawnImpl(command) {
        const child = new FakeChild(command);
        launches.push(child);
        return child;
      },
      logger: { warn() {}, error() {}, info() {} },
    });

    const desktop = supervisor.start(
      "desktop",
      "/tmp",
      "desktop-command",
      [],
      {},
      { restartPolicy: "on-failure", restartDelayMs: 10 },
    );

    desktop.emit("exit", 1, null);
    await sleep(30);

    expect(
      launches.filter((child) => child.command === "desktop-command"),
    ).toHaveLength(2);

    supervisor.shutdown();
  });

  it("handles spawn error plus exit only once for a non-restartable fault domain", () => {
    const fatals = [];
    const supervisor = new DevChildSupervisor({
      spawnImpl(command) {
        return new FakeChild(command);
      },
      logger: { warn() {}, error() {} },
      onFatal(code, meta) {
        fatals.push({ code, meta });
      },
    });

    const child = supervisor.start(
      "runtime",
      "/tmp",
      "runtime-command",
      [],
      {},
      { restartOnExit: false },
    );

    child.emit("error", new Error("spawn failed"));
    child.emit("exit", 1, null);

    expect(fatals).toHaveLength(1);
    expect(fatals[0].code).toBe(1);
    expect(fatals[0].meta.label).toBe("runtime");
  });

  it("cancels a scheduled restart during coordinated shutdown", async () => {
    const launches = [];
    const supervisor = new DevChildSupervisor({
      spawnImpl(command) {
        const child = new FakeChild(command);
        launches.push(child);
        return child;
      },
      logger: { warn() {}, error() {} },
    });

    const host = supervisor.start(
      "connection-host",
      "/tmp",
      "host-command",
      [],
      {},
      { restartOnExit: true, restartDelayMs: 50 },
    );

    host.emit("exit", 1, null);
    supervisor.shutdown();
    await sleep(80);

    expect(launches).toHaveLength(1);
    expect(supervisor.restartTimers.size).toBe(0);
    expect(supervisor.children.size).toBe(0);
  });
});
