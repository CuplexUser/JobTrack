/**
 * Just enough of the extension API to type what this extension actually calls.
 *
 * Declared here rather than pulling in `@types/chrome`, for the same reason
 * `apps/tray/src/types/systray.d.ts` exists: four calls do not justify a dependency, and a
 * hand-written surface this small is easier to check against the documentation than a
 * generated one is to audit.
 */

declare namespace chrome {
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
    }
    function query(info: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
  }

  namespace scripting {
    interface InjectionResult<T> {
      result: T;
    }
    function executeScript<Args extends unknown[], Result>(injection: {
      target: { tabId: number };
      func: (...args: Args) => Result;
      args?: Args;
    }): Promise<InjectionResult<Result>[]>;
  }

  namespace storage {
    interface StorageArea {
      get(keys: string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const local: StorageArea;
  }

  namespace runtime {
    function openOptionsPage(): Promise<void>;
    const lastError: { message?: string } | undefined;
  }
}
