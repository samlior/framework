import { io, ManagerOptions, SocketOptions } from "socket.io-client";
import {
  Scheduler,
  ReturnTypeIs,
  raceNoExcept,
  toNoExcept,
  JSONRPC,
  JSONRPCErrorCode,
  JSONRPCRequest,
  JSONRPCNotify,
  Limited,
  Token,
  debug,
  warn,
  error,
  Events,
} from "@samlior/utils";
import {
  Socket,
  SocketIOHanlders,
  SocketIOHandleFunc,
  ISocketIOHandler,
} from "./types";

export class SocketIOHandlerResponse {
  notify?: {
    method: string;
    params?: any;
  };
  response?: any;

  constructor(
    notify?: {
      method: string;
      params?: any;
    },
    response?: any
  ) {
    if (
      (notify === undefined && response === undefined) ||
      (notify !== undefined && response !== undefined)
    ) {
      throw new Error("invalid response");
    }
    this.notify = notify;
    this.response = response;
  }
}

export interface SocketIOClientOptions {
  socket: Socket;
  handlers?: SocketIOHanlders;
  limited?: Limited;
  parent?: Scheduler;
}

export declare interface SocketIOClient {
  on(event: "connect", listener: () => void): this;
  on(event: "disconnect", listener: () => void): this;

  off(event: "connect", listener: () => void): this;
  off(event: "disconnect", listener: () => void): this;
}

export class SocketIOClient extends Events {
  readonly socket: Socket;
  readonly scheduler: Scheduler;
  readonly limited: Limited;
  readonly handlers: SocketIOHanlders;
  readonly jsonrpc = new JSONRPC();

  /**
   * 链接服务器
   * @param url - 服务器地址
   * @param options - 构造参数和 socket 参数
   * @returns 客户端实例
   */
  static async connect(
    url: string,
    options?: Omit<SocketIOClientOptions, "socket"> &
      Partial<ManagerOptions & SocketOptions>
  ) {
    const socket = io(url, {
      transports: ["websocket"],
      ...options,
    });
    const client = new SocketIOClient({ socket, ...options });
    return client;
  }

  constructor({ socket, limited, parent, handlers }: SocketIOClientOptions) {
    super();
    this.socket = socket;
    this.scheduler = new Scheduler(parent);
    this.limited = limited ?? new Limited(0, 0);
    this.handlers = handlers ?? new Map<string, ISocketIOHandler>();
    this.start();
    this.socket.on("connect", this.handleConnect);
    this.socket.on("disconnect", this.handleDisconnect);
  }

  get id(): string {
    return this.socket.id;
  }

  private async *limitedRun(
    handle: () => ReturnTypeIs<any>
  ): ReturnTypeIs<any> {
    let token: Token;
    const { request, getToken } = this.limited.get();
    if (request) {
      const { ok, error, result } = yield* raceNoExcept(toNoExcept(getToken));
      if (!ok) {
        result && this.limited.put(result);
        this.limited.cancel(request);
        throw error;
      }
      token = result;
    } else {
      token = await getToken;
    }

    try {
      return yield* token.invoke2(handle());
    } finally {
      this.limited.put(token);
    }
  }

  private handleConnect = () => {
    if (this.scheduler.reason === "disconnect") {
      this.scheduler.resume();
    }
    this.scheduler.recover();
    this.emit("connect");
  };

  private handleDisconnect = () => {
    if (!this.scheduler.aborted) {
      this.scheduler.abort("disconnect");
    }
    this.scheduler.destroy();
    this.emit("disconnect");
  };

  private handleJSONRPC = (data: any) => {
    // 1. 解析内容, 如果是返回结果的话, 交给 jsonrpc 处理
    let requestOrNotify: JSONRPCRequest | JSONRPCNotify;
    try {
      const [_type, _result] = JSONRPC.parse(data);
      if (_type === "response") {
        if (!this.jsonrpc.response(_result)) {
          debug("SocketIOClient::handleJSONRPC, invalid response, ignore");
        }
        return;
      }
      requestOrNotify = _result;
    } catch (err) {
      debug("SocketIOClient::handleJSONRPC, invalid request:", err);
      this._jsonrpc(JSONRPC.formatJSONRPCError(err));
      return;
    }
    const { id, method, params } = requestOrNotify;

    // 2. 检查是否达到并发上限
    if (this.limited.available === 0) {
      id !== undefined &&
        this._jsonrpc(JSONRPC.formatJSONRPCError(JSONRPCErrorCode.Sever, id));
      return;
    }

    // 3. 获取对应的 handler
    const handler = this.handlers.get(method);
    if (handler === undefined) {
      debug("SocketIOClient::handleJSONRPC, method not found:", method);
      id !== undefined &&
        this._jsonrpc(
          JSONRPC.formatJSONRPCError(JSONRPCErrorCode.NotFound, id)
        );
      return;
    }
    let limited: boolean;
    let scheduler: Scheduler;
    let handle: SocketIOHandleFunc;
    if (typeof handler === "function") {
      limited = false;
      scheduler = new Scheduler(this.scheduler);
      handle = handler;
    } else {
      limited = handler.limited ?? false;
      scheduler = new Scheduler(handler.parent ?? this.scheduler);
      handle = handler.handle.bind(handler);
    }

    // 3. 开始调度
    scheduler
      .exec(
        limited
          ? this.limitedRun(() => handle(params, this))
          : handle(params, this)
      )
      .then((response) => {
        if (response instanceof SocketIOHandlerResponse) {
          const { notify: _notify, response: _response } = response;
          if (_notify) {
            this._jsonrpc(
              JSONRPC.formatJSONRPCNotify(_notify.method, _notify.params)
            );
            return;
          } else {
            response = _response;
          }
        }
        if (response !== undefined) {
          if (id === undefined) {
            // 这是一个通知, 无法返回
            warn("SocketIOClient::handleJSONRPC, cannot response a notify");
          } else {
            this._jsonrpc(JSONRPC.formatJSONRPCResult(id, response));
          }
        }
      })
      .catch((err) => {
        error("SocketIOClient::handleJSONRPC, catch error:", err);
        id !== undefined && this._jsonrpc(JSONRPC.formatJSONRPCError(err, id));
      })
      .finally(() => {
        scheduler.destroy();
      });
  };

  /**
   * 发送 jsonrpc 消息(底层方法)
   * @param data - 消息内容
   */
  _jsonrpc(data: any) {
    this.socket.emit("jsonrpc", data);
  }

  /**
   * 发出请求
   * @param method - 方法名称
   * @param params - 参数
   * @param timeout - 超时时间
   * @returns 返回结果
   */
  request(method: string, params?: any, timeout?: number) {
    const { request, getResult } = this.jsonrpc.request(
      method,
      params,
      timeout
    );
    this._jsonrpc(request);
    return getResult;
  }

  /**
   * 发送通知
   * @param method - 方法名称
   * @param params - 参数
   */
  notify(method: string, params?: any) {
    this._jsonrpc(JSONRPC.formatJSONRPCNotify(method, params));
  }

  /**
   * 开始
   */
  start() {
    this.socket.on("jsonrpc", this.handleJSONRPC);
  }

  /**
   * 停止
   */
  stop() {
    this.socket.off("jsonrpc", this.handleJSONRPC);
  }

  /**
   * 中断
   * @param reason - 理由
   */
  abort(reason: any) {
    this.scheduler.abort(reason);
    this.jsonrpc.abort(reason);
  }

  /**
   * 恢复
   */
  resume() {
    this.scheduler.resume();
  }

  /**
   * 等待直到所有调用完成
   */
  wait() {
    return Promise.all([
      this.jsonrpc.wait(),
      this.scheduler.wait(),
      this.limited.wait(),
    ]);
  }

  /**
   * 断开链接
   */
  close() {
    this.socket.disconnect(true);
  }
}
