/**
 * Minimal ambient types for the `systray` package (no upstream types or @types package).
 * Covers only the surface this app actually uses — see the README at
 * https://github.com/zaaack/node-systray for the full API.
 */
declare module 'systray' {
  export interface MenuItem {
    title: string;
    tooltip: string;
    checked: boolean;
    enabled: boolean;
  }

  export interface Menu {
    icon: string;
    title: string;
    tooltip: string;
    items: MenuItem[];
  }

  export interface SysTrayConf {
    menu: Menu;
    debug?: boolean;
    copyDir?: boolean;
  }

  export interface ClickAction {
    type: 'clicked';
    item: MenuItem;
    seq_id: number;
  }

  export interface UpdateItemAction {
    type: 'update-item';
    item: MenuItem;
    seq_id: number;
  }

  export default class SysTray {
    constructor(conf: SysTrayConf);
    onClick(listener: (action: ClickAction) => void): void;
    sendAction(action: UpdateItemAction): void;
    kill(exitNode?: boolean): void;
  }
}
