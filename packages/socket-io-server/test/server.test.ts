import net from "net";
import http from "http";
import { assert, expect } from "chai";
import { ReturnTypeIs } from "@samlior/utils";
import {
  ISocketIOHandler,
  SocketIOClientManager,
} from "@samlior/socket-io-client";
import { startup, shutdown, SocketIOServer } from "../src";

const port = 65432;
const namespace = "/namespace";

class MockEchoHandler implements ISocketIOHandler {
  async *handle(params: any): ReturnTypeIs<string> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return params;
  }
}

class MockClientEchoHandler implements ISocketIOHandler {
  async *handle(params: any): ReturnTypeIs<string> {
    if (typeof params !== "string") {
      throw new Error("invalid params");
    }
    return "from client " + params;
  }
}

describe("SocketIO Server", function () {
  beforeEach(async function () {
    // 构造
    const { server, httpServer, terminator } = await startup(
      { maxTokens: 10, maxQueued: 2, namespace },
      port
    );
    this.server = server;
    this.httpServer = httpServer;
    this.terminator = terminator;

    // 注册 handler
    this.server.register("echo", new MockEchoHandler());

    this.manager = new SocketIOClientManager();
    this.manager.register("clientEcho", new MockClientEchoHandler());

    // TODO: ugly
    server.server.of("/").on("connection", (socket) => {
      socket.disconnect(true);
    });
  });

  afterEach(async function () {
    await shutdown(this.server, this.terminator);
  });

  it("should echo succeed", async function () {
    const client = await this.manager.connect(
      `ws://127.0.0.1:${port}${namespace}`
    );
    expect(await client.request("echo", "wuhu")).be.eq("wuhu");
    client.socket.disconnect(true);
  });

  it("should echo succeed(client)", async function () {
    const client = await this.manager.connect(
      `ws://127.0.0.1:${port}${namespace}`
    );
    await new Promise<void>((r) => setTimeout(r, 100));
    const serverSideClient = (this.server as SocketIOServer).clients.get(
      client.id
    );
    expect(serverSideClient !== undefined).be.true;
    expect(await serverSideClient!.request("clientEcho", "wuhu")).be.eq(
      "from client wuhu"
    );
    client.socket.disconnect(true);
  });

  it("should echo failed(invalid params)", async function () {
    const client = await this.manager.connect(
      `ws://127.0.0.1:${port}${namespace}`
    );
    let err = false;
    try {
      await client.request("echo", 1);
      err = true;
    } catch (err) {
      // ignore
    }
    assert(!err);
    client.socket.disconnect(true);
  });

  it("should echo failed(namespace)", async function () {
    const client = await this.manager.connect(`ws://127.0.0.1:${port}`);
    let err = false;
    try {
      await client.request("echo", "wuhu", 100);
      err = true;
    } catch (err) {
      // ignore
    }
    assert(!err);
    client.socket.disconnect(true);
  });

  it("should echo succeed(reconnect)", async function () {
    // 获取底层 socket 对象
    let socket: net.Socket | null = null;
    (this.httpServer as http.Server).on("connection", (_socket) => {
      socket = _socket;
    });
    const client = await this.manager.connect(
      `ws://127.0.0.1:${port}${namespace}`,
      {
        reconnectionDelay: 100,
        reconnectionDelayMax: 200,
      }
    );
    expect(await client.request("echo", "wuhu")).be.eq("wuhu");
    expect(socket).not.eq(null);
    // 手动关闭底层 socket
    socket!.destroy(new Error("manually destroy"));
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(await client.request("echo", "wuhu")).be.eq("wuhu");
    client.socket.disconnect(true);
  });
});
