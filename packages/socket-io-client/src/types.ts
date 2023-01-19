import type { Scheduler, ReturnTypeIs } from "@samlior/utils";
import type { SocketIOClient } from "./client";

export interface Socket {
  readonly id: string;

  on(event: string, listener: (...args: any[]) => void): this;

  off(event: string, listener: (...args: any[]) => void): this;

  emit(event: string, ...args: any[]): boolean | this;

  disconnect(flag?: boolean): this;
}

export type SocketIOHandleFunc = (
  params: any,
  client: SocketIOClient
) => ReturnTypeIs<any>;

export interface ISocketIOHandler {
  parent?: Scheduler;
  limited?: boolean;
  handle: SocketIOHandleFunc;
}

export type SocketIOHandler = ISocketIOHandler | SocketIOHandleFunc;

export type SocketIOHanlders = Map<string, SocketIOHandler>;
