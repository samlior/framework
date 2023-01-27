import { Request, Response } from "express";
import {
  Scheduler,
  ReturnTypeIs,
  JSONRPC,
  JSONRPCRequest,
  JSONRPCErrorCode,
  Limited,
  limitedRun,
  error,
  debug,
} from "@samlior/utils";

export class HTTPHandlerResponse {
  status?: number;
  headers?: { [key: string]: string };
  result?: any;

  constructor(
    status?: number,
    headers?: { [key: string]: string },
    result?: any
  ) {
    this.status = status;
    this.headers = headers;
    this.result = result;
  }
}

export type HTTPHandleFunc = (params: any) => ReturnTypeIs<any>;

export interface IHTTPHanlder {
  parent?: Scheduler;
  limited?: boolean;
  handle: HTTPHandleFunc;
}

export type HTTPHanlder = IHTTPHanlder | HTTPHandleFunc;

export interface HTTPServerOptions {
  // 最大并发数量
  maxTokens?: number;
  // 最大队列数量
  maxQueued?: number;
  // 并发控制器
  limited?: Limited;
  // 父级调度器
  parent?: Scheduler;
  // 外部指定的方法
  handlers?: Map<string, HTTPHanlder>;
}

export class HTTPServer {
  readonly scheduler: Scheduler;
  readonly limited?: Limited;
  readonly handlers: Map<string, HTTPHanlder>;

  private _stopped: boolean = false;

  constructor({
    maxTokens,
    maxQueued,
    limited,
    parent,
    handlers,
  }: HTTPServerOptions) {
    this.scheduler = new Scheduler(parent);
    this.handlers = handlers ?? new Map<string, HTTPHanlder>();
    if (limited) {
      this.limited = limited;
    } else if (maxTokens !== undefined && maxQueued !== undefined) {
      this.limited = new Limited(maxTokens, maxQueued);
    }
  }

  /**
   * 服务是否停止
   */
  get stopped() {
    return this._stopped;
  }

  /**
   * 开始接受新请求
   */
  start() {
    this._stopped = false;
  }

  /**
   * 停止 HTTP 服务
   * 不会接受新的请求,
   * 但在处理中的请求不会受到影响
   */
  stop() {
    this._stopped = true;
  }

  /**
   * 中断所有请求的处理
   * @param reason - 中断原因
   */
  abort(reason: any) {
    this.scheduler.abort(reason);
  }

  /**
   * 恢复中断
   */
  resume() {
    this.scheduler.resume();
  }

  /**
   * 等待所有请求处理完毕
   */
  wait() {
    const promises: Promise<void>[] = [this.scheduler.wait()];
    if (this.limited) {
      promises.push(this.limited.wait());
    }
    return Promise.all(promises);
  }

  /**
   * 注册 handler
   * @param method - 方法名
   * @param handler - 处理器
   */
  register(method: string, handler: HTTPHanlder) {
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

  /**
   * 检查是否停止的中间件
   */
  checkIfStopped() {
    return (req: Request, res: Response, next: (err?: any) => void) => {
      if (this._stopped) {
        res.status(503).send();
        return next(new Error("stopped"));
      }
      next();
    };
  }

  /**
   * 检查并发是否达到上限的中间件
   */
  checkIfAvailable() {
    return (req: Request, res: Response, next: (err?: any) => void) => {
      if (this.limited && this.limited.available === 0) {
        res.status(503).send();
        return next(new Error("unavailable"));
      }
      next();
    };
  }

  /**
   * 处理请求的中间件
   */
  handle() {
    return (req: Request, res: Response, next: () => void) => {
      // 1. 解析 jsonrpc 请求
      let request: JSONRPCRequest;
      try {
        const [_type, _request] = JSONRPC.parse(req.body);
        if (_type !== "request") {
          throw new Error("invalid jsonrpc response, it should be a request");
        }
        request = _request;
      } catch (err) {
        debug("HTTPServer::handle, invalid request:", err);
        res.json(JSONRPC.formatJSONRPCError(err));
        return next();
      }

      // 2. 获取对应的 handler
      const { id, method, params } = request;
      const handler = this.handlers.get(method);
      if (handler === undefined) {
        res.json(JSONRPC.formatJSONRPCError(JSONRPCErrorCode.NotFound, id));
        return next();
      }
      let limited: boolean;
      let scheduler: Scheduler;
      let handle: HTTPHandleFunc;
      if (typeof handler === "function") {
        limited = true;
        scheduler = new Scheduler(this.scheduler);
        handle = handler;
      } else {
        limited = handler.limited ?? true;
        scheduler = new Scheduler(handler.parent ?? this.scheduler);
        handle = handler.handle.bind(handler);
      }
      const abort = () => {
        if (scheduler.parallels > 0 && !scheduler.aborted) {
          scheduler.abort("disconnected");
        }
      };

      // 3. 开始调度
      scheduler
        .exec(
          limited && this.limited
            ? limitedRun(this.limited, () => handle(params))
            : handle(params)
        )
        .then((response) => {
          if (response instanceof HTTPHandlerResponse) {
            const { status, headers, result } = response;
            res.status(status ?? 200);
            if (headers) {
              for (const key in headers) {
                res.setHeader(key, headers[key]);
              }
            }
            response = result;
          }
          if (response !== undefined) {
            res.json(JSONRPC.formatJSONRPCResult(id, response));
          }
        })
        .catch((err) => {
          if (err === "disconnected") {
            // ignore disconnet error
            return;
          }
          error("HTTPServer::handle, method:", method, "catch error:", err);
          res.json(JSONRPC.formatJSONRPCError(err, id));
        })
        .finally(() => {
          scheduler.destroy();
          req.socket.off("close", abort);
          next();
        });

      // 4. 监听客户端断开事件
      req.socket.on("close", abort);
    };
  }
}
