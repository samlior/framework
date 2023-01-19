import { Sequelize, Options, SyncOptions } from "sequelize";

export interface DatabaseOptions {
  // 主数据库路径
  master: string;
  // 从数据库路径
  slaves?: string[];
  // 数据库选项
  options?: Options;
}

export class Database {
  readonly master: Sequelize;
  readonly slaves?: Sequelize[];

  private slaveIndex = 0;

  constructor({ master, slaves, options }: DatabaseOptions) {
    this.master = new Sequelize(master, options);
    if (slaves) {
      this.slaves = slaves.map((slave) => new Sequelize(slave, options));
    }
  }

  /**
   * 获取所有链接
   */
  get seqs() {
    return [this.master, ...(this.slaves ?? [])];
  }

  /**
   * 随机选取一个 slave 链接
   */
  get slave() {
    if (!this.slaves || this.slaves.length === 0) {
      return this.master;
    }
    const slave = this.slaves[this.slaveIndex++];
    if (this.slaveIndex === this.slaves.length) {
      this.slaveIndex = 0;
    }
    return slave;
  }

  /**
   * 认证
   */
  authenticate() {
    return Promise.all(this.seqs.map((seq) => seq.authenticate()));
  }

  /**
   * 同步所有表
   * @param options - 同步参数
   */
  sync(options?: SyncOptions) {
    return this.master.sync(options);
  }

  /**
   * 关闭所有链接
   */
  close() {
    return Promise.all(this.seqs.map((seq) => seq.close()));
  }
}
