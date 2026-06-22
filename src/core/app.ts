import type { AppOptions, Plugin } from '../types/index.js';

export class App {
  readonly name: string;
  readonly version: string;
  private readonly plugins: Plugin[] = [];

  constructor(options: AppOptions) {
    this.name = options.name;
    this.version = options.version ?? '0.0.0';
  }

  use(plugin: Plugin): this {
    this.plugins.push(plugin);
    return this;
  }

  async start(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.setup(this);
    }
  }
}

export function createApp(options: AppOptions): App {
  return new App(options);
}
