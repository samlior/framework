import { expect } from "chai";
import * as s from "../src/scheduler";

describe("Scheduler", function () {
  async function* increaseTo10_run(): s.ReturnTypeIs<number> {
    let i = 0;
    for (; i < 10; i++) {
      const { ok } = yield* s.runNoExcept(
        s.toNoExcept(new Promise<void>((resolve) => setTimeout(resolve, 10)))
      );
      if (!ok) {
        break;
      }
    }
    return i;
  }

  async function* increaseTo10_race(): s.ReturnTypeIs<number> {
    let i = 0;
    for (; i < 10; i++) {
      let timeout: NodeJS.Timeout | undefined = undefined;
      const { ok } = yield* s.raceNoExcept(
        s.toNoExcept(
          new Promise<void>(
            (resolve) =>
              (timeout = setTimeout(() => {
                timeout = undefined;
                resolve();
              }, 10))
          )
        )
      );
      if (!ok) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        break;
      }
    }
    return i;
  }

  async function* increaseTo10_manuallyCheck(): s.ReturnTypeIs<number> {
    let i = 0;
    for (; i < 10; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const { ok } = yield* s.checkNoExcept();
      if (!ok) {
        break;
      }
    }
    return i;
  }

  it("should exec succeed", async function () {
    const results: Promise<number>[] = [
      s.exec(increaseTo10_run()).getResult,
      s.exec(increaseTo10_race()).getResult,
      s.exec(increaseTo10_manuallyCheck()).getResult,
    ];
    for (const getResult of results) {
      expect(await getResult).be.eq(10);
    }
  });

  it("should abort succeed(run)", async function () {
    const { abort, getResult } = s.exec(increaseTo10_run());
    setTimeout(() => abort("canceled"), 55);
    expect(await getResult).be.lt(10);
  });

  it("should abort succeed(race)", async function () {
    const { abort, getResult } = s.exec(increaseTo10_race());
    setTimeout(() => abort("canceled"), 55);
    expect(await getResult).be.lt(10);
  });

  it("should abort succeed(manuallyCheck)", async function () {
    const { abort, getResult } = s.exec(increaseTo10_manuallyCheck());
    setTimeout(() => abort("canceled"), 55);
    expect(await getResult).be.lt(10);
  });

  it("should abort and wait succeed", async function () {
    const results: Promise<number>[] = [];
    const parent = new s.Scheduler();
    results.push(parent.exec(increaseTo10_run()));
    const children: s.Scheduler[] = [];
    for (let i = 0; i < 3; i++) {
      const child = new s.Scheduler(parent);
      results.push(child.exec(increaseTo10_run()));
      children.push(child);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 55));
    parent.abort("canceld");
    await parent.wait();
    for (const getResult of results) {
      expect(await getResult).be.lt(10);
    }
    expect(parent.parallels).be.eq(0);
    expect(parent.aborted).be.true;
    for (const child of children) {
      expect(child.parallels).be.eq(0);
      expect(child.aborted).be.true;
    }
  });
});
