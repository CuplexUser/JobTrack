/**
 * Just enough of the extension API to type what this extension actually calls.
 *
 * Declared here rather than pulling in `@types/chrome`, for the same reason
 * `apps/tray/src/types/systray.d.ts` exists: a handful of calls do not justify a dependency, and a
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
    function create(properties: { url: string; active?: boolean }): Promise<Tab>;
    function get(tabId: number): Promise<Tab & { status?: string }>;
    function getCurrent(): Promise<Tab | undefined>;
    function update(tabId: number, properties: { active?: boolean }): Promise<Tab>;
    function remove(tabId: number): Promise<void>;

    interface TabEvent<Listener> {
      addListener(listener: Listener): void;
      removeListener(listener: Listener): void;
    }
    const onUpdated: TabEvent<(tabId: number, changeInfo: { status?: string }) => void>;
    const onRemoved: TabEvent<(tabId: number) => void>;
  }

  namespace scripting {
    interface InjectionResult<T> {
      result: T;
    }
    function executeScript<Args extends unknown[], Result>(injection: {
      target: { tabId: number };
      func: (...args: Args) => Result;
      args?: Args;
    }): Promise<InjectionResult<Awaited<Result>>[]>;
  }

  namespace storage {
    interface StorageArea {
      get(keys: string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const local: StorageArea;
  }

  namespace permissions {
    interface Permissions {
      origins?: string[];
      permissions?: string[];
    }
    function contains(permissions: Permissions): Promise<boolean>;
    function request(permissions: Permissions): Promise<boolean>;
  }

  namespace runtime {
    function openOptionsPage(): Promise<void>;
    const lastError: { message?: string } | undefined;
  }
}
