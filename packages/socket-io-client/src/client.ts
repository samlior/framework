import {
  Scheduler,
  JSONRPC,
  JSONRPCErrorCode,
  JSONRPCRequest,
  JSONRPCNotify,
  Limited,
  limitedRun,
  debug,
  warn,
  error,
  Events,
} from "@samlior/utils";
import { Socket, SocketIOHandleFunc, SocketIOHandler } from "./types";

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

export interface SocketIOClientOptions<T> {
  socket: Socket;
  maxTokens?: number;
  maxQueued?: number;
  limited?: Limited;
  handlers?: Map<string, SocketIOHandler<T>>;
  parent?: Scheduler;
}

export declare interface SocketIOClient<T = any> {
  on(event: "connect", listener: () => void): this;
  on(event: "disconnect", listener: () => void): this;

  off(event: "connect", listener: () => void): this;
  off(event: "disconnect", listener: () => void): this;
}

export class SocketIOClient<T = any> extends Events {
  readonly socket: Socket;
  readonly scheduler: Scheduler;
  readonly limited?: Limited;
  readonly handlers: Map<string, SocketIOHandler<T>>;
  readonly jsonrpc = new JSONRPC();

  // 允许用户自定义的字段
  userData?: T;

  constructor({
    socket,
    parent,
    handlers,
    maxTokens,
    maxQueued,
    limited,
  }: SocketIOClientOptions<T>) {
    super();
    this.socket = socket;
    this.scheduler = new Scheduler(parent);
    if (limited) {
      this.limited = limited;
    } else if (maxTokens !== undefined && maxQueued !== undefined) {
      this.limited = new Limited(maxTokens, maxQueued);
    }
    this.handlers = handlers ?? new Map<string, SocketIOHandler<T>>();
    this.socket.on("connect", this.handleConnect);
    this.socket.on("disconnect", this.handleDisconnect);

    // 客户端直接开始运行
    this.start();
  }

  get id(): string {
    return this.socket.id;
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
          debug("SocketIOClient::handleJSONRPC", "invalid response, ignore");
        }
        return;
      }
      requestOrNotify = _result;
    } catch (err) {
      debug("SocketIOClient::handleJSONRPC", "invalid request:", err);
      this._jsonrpc(JSONRPC.formatJSONRPCError(err));
      return;
    }
    const { id, method, params } = requestOrNotify;

    // 2. 检查是否达到并发上限
    if (this.limited && this.limited.available === 0) {
      id !== undefined &&
        this._jsonrpc(JSONRPC.formatJSONRPCError(JSONRPCErrorCode.Sever, id));
      return;
    }

    // 3. 获取对应的 handler
    const handler = this.handlers.get(method);
    if (handler === undefined) {
      debug("SocketIOClient::handleJSONRPC", "method not found:", method);
      id !== undefined &&
        this._jsonrpc(
          JSONRPC.formatJSONRPCError(JSONRPCErrorCode.NotFound, id)
        );
      return;
    }
    let limited: boolean;
    let scheduler: Scheduler;
    let handle: SocketIOHandleFunc<T>;
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
        limited && this.limited
          ? limitedRun(this.limited, () => handle(params, this))
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
            warn("SocketIOClient::handleJSONRPC", "cannot response a notify");
          } else {
            this._jsonrpc(JSONRPC.formatJSONRPCResult(id, response));
          }
        }
      })
      .catch((err) => {
        error("SocketIOClient::handleJSONRPC", "catch error:", err);
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
    const promises: Promise<void>[] = [
      this.jsonrpc.wait(),
      this.scheduler.wait(),
    ];
    if (this.limited) {
      promises.push(this.limited.wait());
    }
    return Promise.all(promises);
  }

  /**
   * 断开链接
   */
  close() {
    this.socket.disconnect(true);
  }
}
