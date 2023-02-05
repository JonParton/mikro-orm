import { defineConfig, MikroORM } from '@mikro-orm/core';
import type { Options, IDatabaseDriver } from '@mikro-orm/core';
import { MongoDriver } from './MongoDriver';

/**
 * @inheritDoc
 */
export class MongoMikroORM extends MikroORM<MongoDriver> {

  private static DRIVER = MongoDriver;

  /**
   * @inheritDoc
   */
  static override async init<D extends IDatabaseDriver = MongoDriver>(options?: Options<D>): Promise<MikroORM<D>> {
    return super.init(options);
  }

}

export type MongoOptions = Options<MongoDriver>;

/* istanbul ignore next */
export function defineMongoConfig(options: MongoOptions) {
  return defineConfig({ driver: MongoDriver, ...options });
}
