import { expect } from "chai";
import { Server } from "socket.io";
import { createClient } from "redis";
import { createAdapter } from "@socket.io/redis-adapter";
import { JSONRPC, ReturnTypeIs, timeout } from "@samlior/utils";
import {
  SocketIOServerSide,
  IServerSideHandler,
  ServerSideHandlerResponse,
} from "../src";

const port0 = 43210;
const port1 = 43211;
const port2 = 43212;
const redisURL = "redis://default:redispw@localhost:49153";

class MockEchoHandler implements IServerSideHandler {
  async *handle(params: any): ReturnTypeIs<string> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return params;
  }
}

class MockEchoNotifyHandler implements IServerSideHandler {
  async *handle(params: any): ReturnTypeIs<ServerSideHandlerResponse> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return new ServerSideHandlerResponse({
      method: "echoNotifyResponse",
      params,
    });
  }
}

describe("SocketIO Server Side", function () {
  function createServerSide(
    this: Mocha.Context,
    name: string,
    port: number,
    pub: any,
    sub: any
  ) {
    this.server[name] = new Server();
    this.server[name].adapter(createAdapter(pub, sub));
    this.server[name].listen(port);
    this.serverSide[name] = new SocketIOServerSide({
      name,
      server: this.server[name],
    });
    this.serverSide[name].register("echo", new MockEchoHandler());
    this.serverSide[name].register("echoNotify", new MockEchoNotifyHandler());
    this.serverSide[name].start();
  }

  function server(this: Mocha.Context, name: string): Server {
    return this.server[name];
  }

  function serverSide(this: Mocha.Context, name: string): SocketIOServerSide {
    return this.serverSide[name];
  }

  async function closeServer(server: Server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      })
    );
  }

  async function closeServerSide(serverSide: SocketIOServerSide) {
    serverSide.stop();
    await timeout(serverSide.wait()).catch(() => undefined);
  }

  function receiveNotifyResponses(this: Mocha.Context, servers: Set<string>) {
    return new Promise<Map<string, any>>((resolve, reject) => {
      const emitter = server.call(this, "emitter");
      const responses = new Map<string, any>();
      let listener: any;
      emitter.on(
        "message",
        (listener = (from: string, to: string, response: any) => {
          if (to !== "emitter") {
            return;
          }
          if (!servers.delete(from)) {
            emitter.off("message", listener);
            reject(new Error("unknown from: " + from));
            return;
          }
          const [_type, _notify] = JSONRPC.parse(response);
          if (_type !== "notify" || _notify.method !== "echoNotifyResponse") {
            emitter.off("message", listener);
            reject(new Error("invalid response from: " + from));
            return;
          }
          responses.set(from, _notify.params);
          if (servers.size === 0) {
            emitter.off("message", listener);
            resolve(responses);
          }
        })
      );
    });
  }

  before(function () {
    this.server = {};
    this.serverSide = {};
  });

  beforeEach(async function () {
    this.pub = createClient({ url: redisURL });
    this.sub = this.pub.duplicate();
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    createServerSide.call(this, "emitter", port0, this.pub, this.sub);
    createServerSide.call(this, "server1", port1, this.pub, this.sub);
    createServerSide.call(this, "server2", port2, this.pub, this.sub);
  });

  afterEach(async function () {
    await closeServer(server.call(this, "emitter"));
    await closeServer(server.call(this, "server1"));
    await closeServer(server.call(this, "server2"));
    await closeServerSide(serverSide.call(this, "emitter"));
    await closeServerSide(serverSide.call(this, "server1"));
    await closeServerSide(serverSide.call(this, "server2"));
    await this.pub.disconnect();
    await this.sub.disconnect();
  });

  it("should echo succeed(1)", async function () {
    expect(
      await serverSide.call(this, "emitter").request("server1", "echo", "wuhu")
    ).be.eq("wuhu");
  });

  it("should echo succeed(2)", async function () {
    expect(
      await serverSide.call(this, "emitter").request("server2", "echo", "wuhu")
    ).be.eq("wuhu");
  });

  it("should broadcast succeed", async function () {
    const promise = receiveNotifyResponses.call(
      this,
      new Set<string>(["server1", "server2"])
    );
    serverSide.call(this, "emitter").broadcast("echoNotify", "wuhu");
    const responses = await promise;
    expect(responses.get("server1")).be.eq("wuhu");
    expect(responses.get("server2")).be.eq("wuhu");
  });
});
