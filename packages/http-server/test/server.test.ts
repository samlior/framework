import { expect } from "chai";
import { ReturnTypeIs, toNoExcept, raceNoExcept } from "@samlior/utils";
import { HTTPClient } from "@samlior/http-client";
import { IHTTPHanlder, startup, shutdown } from "../src";

const port = 54321;
const namespace = "/namespace";

class MockEchoHandler implements IHTTPHanlder {
  async *handle(params: any): ReturnTypeIs<string> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return params;
  }
}

class MockLongTimeHandler implements IHTTPHanlder {
  async *handle(): ReturnTypeIs<string> {
    let timeout: NodeJS.Timeout | undefined = undefined;
    let resolve: (() => void) | undefined = undefined;
    const { ok } = yield* raceNoExcept(
      toNoExcept(
        new Promise<void>((r) => {
          resolve = r;
          timeout = setTimeout(() => {
            timeout = undefined;
            resolve = undefined;
            r();
          }, 1000);
        })
      )
    );
    if (!ok) {
      if (resolve) {
        (resolve as any)();
        resolve = undefined;
      }
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      return "canceled";
    }
    return "ok";
  }
}

describe("HTTPServer", function () {
  beforeEach(async function () {
    const { server, httpServer, terminator } = await startup(
      {
        maxTokens: 10,
        maxQueued: 2,
      },
      namespace,
      port
    );
    this.server = server;
    this.httpServer = httpServer;
    this.terminator = terminator;

    // 注册 handler
    this.server.register("echo", new MockEchoHandler());
    this.server.register("longTime", new MockLongTimeHandler());

    // 开启服务器
    this.server.start();
  });

  afterEach(async function () {
    await shutdown(this.server, this.terminator);
  });

  it("should echo succeed", async function () {
    const client = new HTTPClient(`http://localhost:${port}${namespace}`);
    const { getResult } = client.request("echo", "wuhu");
    expect(await getResult).be.eq("wuhu");
    await new Promise((r) => setTimeout(r, 10));
    expect(client.aborters.length).be.eq(0);
  });

  it("should echo failed", async function () {
    const client = new HTTPClient(`http://localhost:${port}${namespace}`);
    const { getResult } = client.request("echo", 1);
    const { ok, error } = await toNoExcept(getResult);
    expect(ok).be.false;
    expect(error).be.deep.eq({ code: -32603, message: "invalid params" });
  });

  it("should be timeout", async function () {
    const client = new HTTPClient(`http://localhost:${port}`);
    const { getResult } = client.request("longTime", undefined, 100);
    const { ok, error } = await toNoExcept(getResult);
    expect(ok).be.false;
    expect(error.message.startsWith("timeout")).be.true;
  });

  it("should abort succeed(1)", async function () {
    const client = new HTTPClient(`http://localhost:${port}`);
    const { abort, getResult } = client.request("longTime");
    setTimeout(() => abort("aborted"), 30);
    const { ok, error } = await toNoExcept(getResult);
    expect(ok).be.false;
    expect(error.message).be.eq("canceled");
  });

  it("should abort succeed(2)", async function () {
    const client = new HTTPClient(`http://localhost:${port}`);
    const getResults: Promise<string>[] = [];
    for (let i = 0; i < 10; i++) {
      const { getResult } = client.request("longTime");
      getResults.push(
        getResult
          .then(() => "failed")
          .catch((err) => (err === "aborted" ? "ok" : "failed"))
      );
    }
    setTimeout(() => client.abort("aborted"), 30);
    for (const getResult of getResults) {
      expect(await getResult).be.eq("ok");
    }
  });
});
