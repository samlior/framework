import Events from "events";
import { Server, Socket } from "socket.io";
import { Scheduler, Limited, warn } from "@samlior/utils";
import { SocketIOClient, SocketIOHandler } from "@samlior/socket-io-client";

const defaultNamespace = "/";

export interface SocketIOServerOptions<T> {
  // socketIO 服务实例
  server: Server;
  // 最大并发数量
  maxTokens?: number;
  // 最大队列数量
  maxQueued?: number;
  // 并发控制器
  limited?: Limited;
  // 命名空间
  namespace?: string;
  // 父级调度器
  parent?: Scheduler;
  // 外部指定的方法
  handlers?: Map<string, SocketIOHandler<T>>;
}

export declare interface SocketIOServer<T = any> {
  on(event: "connect", listener: (client: SocketIOClient<T>) => void): this;
  on(event: "disconnect", listener: (client: SocketIOClient<T>) => void): this;

  off(event: "connect", listener: (client: SocketIOClient<T>) => void): this;
  off(event: "disconnect", listener: (client: SocketIOClient<T>) => void): this;
}

export class SocketIOServer<T = any> extends Events {
  readonly namespace: string;
  readonly scheduler: Scheduler;
  readonly server: Server;
  readonly limited?: Limited;
  readonly handlers: Map<string, SocketIOHandler<T>>;
  readonly clients = new Map<string, SocketIOClient<T>>();

  constructor({
    server,
    maxTokens,
    maxQueued,
    limited,
    namespace,
    parent,
    handlers,
  }: SocketIOServerOptions<T>) {
    super();
    this.namespace = namespace ?? defaultNamespace;
    this.server = server;
    this.handlers = handlers ?? new Map<string, SocketIOHandler<T>>();
    this.scheduler = new Scheduler(parent);
    if (limited) {
      this.limited = limited;
    } else if (maxTokens !== undefined && maxQueued !== undefined) {
      this.limited = new Limited(maxTokens, maxQueued);
    }
  }

  // 处理每一个新链接的 socket
  private handle = (socket: Socket) => {
    const old = this.clients.get(socket.id);
    if (old) {
      warn("SocketIOServer::handle", "client already exists, id:", socket.id);
      old.abort(new Error("repeat socket id"));
      old.stop();
      old.close();
    }

    const client = new SocketIOClient<T>({
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

      // 发出断开事件
      this.emit("disconnect", client);
    };
    client.on("disconnect", handleDisconnect);

    // 发出链接事件
    this.emit("connect", client);
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
  register(method: string, handler: SocketIOHandler<T>) {
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
