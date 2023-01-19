import net from "net";
import axios from "axios";
import LinkedList, { Node } from "yallist";
import { JSONRPC } from "@samlior/utils";

const defaultTimeout = 3000;

function toNode<T>(value: T): Node<T> {
  return {
    prev: null,
    next: null,
    value,
  };
}

export class HTTPClient {
  readonly url: string;
  readonly aborters = LinkedList.create<AbortController>();
  readonly jsonrpc = new JSONRPC();

  constructor(url: string) {
    this.url = url;
  }

  /**
   * 获取并发数量
   */
  get parallels() {
    return this.jsonrpc.requests;
  }

  /**
   * 中断所有请求
   * @param reason - 中断理由
   */
  abort(reason: any) {
    this.jsonrpc.abort(reason);
    for (const aborter of this.aborters) {
      aborter.abort(reason);
    }
  }

  /**
   * 等待所有请求完成
   */
  wait() {
    return this.jsonrpc.wait();
  }

  /**
   * 发送 jsonrpc 请求
   * @param method - 方法名
   * @param params - 方法参数
   * @param timeout - 超时时间
   * @returns 中断函数以及请求结果
   */
  request(method: string, params?: any, timeout?: number) {
    // 将 jsonrpc 设置为永不超时,
    // 超时由 axios 负责
    const { request, getResult } = this.jsonrpc.request(method, params, -1);
    // 创建中断器
    const aborter = new AbortController();
    const node = toNode(aborter);
    this.aborters.pushNode(node);
    // 发送请求
    axios
      .post(this.url, request, {
        signal: aborter.signal,
        timeout: timeout ?? defaultTimeout,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      })
      .then((result) => {
        if (!this.jsonrpc.response(result.data)) {
          this.jsonrpc.response({
            id: request.id,
            error: new Error("invalid response jsonrpc id"),
          });
        }
      })
      .catch((error) => {
        // hack axios, 当出错时关闭 socket
        const socket = error?.request?._currentRequest?.socket;
        if (socket instanceof net.Socket) {
          if (!socket.destroyed) {
            socket.destroy();
          }
        }
        this.jsonrpc.response({ id: request.id, error });
      })
      .finally(() => {
        this.aborters.removeNode(node);
      });
    return {
      abort: (reason?: any) => aborter.abort(reason),
      getResult,
    };
  }
}
