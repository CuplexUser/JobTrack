/**
 * Initializes i18next with the same resources the app boots with, so `useTranslation()` and
 * `waitingSentence()`'s `t` resolve real (English) strings in tests rather than raw keys.
 */
import './i18n.js';

/**
 * jsdom does not implement matchMedia, and Ant Design's responsive components call it on
 * mount. Without this every component test fails before it renders anything.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
