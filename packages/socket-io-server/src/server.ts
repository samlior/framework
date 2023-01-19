import { Server, Socket } from "socket.io";
import { Scheduler, Limited, warn } from "@samlior/utils";
import {
  SocketIOClient,
  SocketIOHandler,
  ISocketIOHandler,
} from "@samlior/socket-io-client";

const defaultNamespace = "/";

export interface SocketIOServerOptions {
  // socketIO 服务实例
  server: Server;
  // 最大并发数量
  maxTokens: number;
  // 最大队列数量
  maxQueued: number;
  // 命名空间
  namespace?: string;
  // 父级调度器
  parent?: Scheduler;
}

export class SocketIOServer {
  readonly namespace: string;
  readonly scheduler: Scheduler;
  readonly server: Server;
  readonly limited: Limited;
  readonly handlers = new Map<string, SocketIOHandler>();
  readonly clients = new Map<string, SocketIOClient>();

  constructor({
    server,
    maxTokens,
    maxQueued,
    namespace,
    parent,
  }: SocketIOServerOptions) {
    this.namespace = namespace ?? defaultNamespace;
    this.server = server;
    this.scheduler = new Scheduler(parent);
    this.limited = new Limited(maxTokens, maxQueued);
    this.start();
  }

  // 处理每一个新链接的 socket
  private handle = (socket: Socket) => {
    const old = this.clients.get(socket.id);
    if (old) {
      warn("SocketIOServer::handle, client already exists, id:", socket.id);
      old.abort(new Error("repeat socket id"));
      old.close();
    }

    const client = new SocketIOClient({
      socket,
      limited: this.limited,
      parent: this.scheduler,
      handlers: this.handlers,
    });
    this.clients.set(client.id, client);
    const handleDisconnect = () => {
      if (this.clients.get(client.id) === client) {
        this.clients.delete(client.id);
      }
      client.off("disconnect", handleDisconnect);
    };
    client.on("disconnect", handleDisconnect);
  };

  /**
   * 开始接受新链接
   */
  start() {
    this.server.of(this.namespace).on("connection", this.handle);
  }

  /**
   * 停止接受新链接
   */
  stop() {
    this.server.of(this.namespace).off("connection", this.handle);
  }

  /**
   * 中断
   * @param reason - 理由
   */
  abort(reason: any) {
    this.scheduler.abort(reason);
    for (const client of this.clients.values()) {
      client.abort(reason);
    }
  }

  /**
   * 恢复
   */
  resume() {
    this.scheduler.resume();
    for (const client of this.clients.values()) {
      client.resume();
    }
  }

  /**
   * 等待直到所有调用完成
   */
  wait() {
    return Promise.all(
      Array.from(this.clients.values()).map((client) => client.wait())
    );
  }

  /**
   * 注册 handler
   * @param method - 方法名
   * @param handler - 处理器
   */
  register(method: string, handler: ISocketIOHandler) {
    this.handlers.set(method, handler);
  }

  /**
   * 注销 handler
   * @param method - 方法名
   * @returns 是否注销成功
   */
  unregister(method: string) {
    return this.handlers.delete(method);
  }
}
