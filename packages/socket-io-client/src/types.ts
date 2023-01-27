import type { Scheduler, ReturnTypeIs } from "@samlior/utils";
import type { SocketIOClient } from "./client";

export interface Socket {
  readonly id: string;

  on(event: string, listener: (...args: any[]) => void): this;

  off(event: string, listener: (...args: any[]) => void): this;

  emit(event: string, ...args: any[]): boolean | this;

  disconnect(flag?: boolean): this;
}

export type SocketIOHandleFunc<T = any> = (
  params: any,
  client: SocketIOClient<T>
) => ReturnTypeIs<any>;

export interface ISocketIOHandler<T = any> {
  parent?: Scheduler;
  limited?: boolean;
  handle: SocketIOHandleFunc<T>;
}

export type SocketIOHandler<T = any> =
  | ISocketIOHandler<T>
  | SocketIOHandleFunc<T>;
