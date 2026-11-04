/**
 * Asks before leaving a page that has edits nobody saved.
 *
 * A card with its own Save button reports whether its fields differ from what is stored
 * (`useReportUnsaved`). While any card says so, following a link to another page opens a
 * confirmation first, and closing or reloading the tab gets the browser's own prompt.
 *
 * One provider for the whole app because a router takes only one blocker at a time, and a
 * page like Settings has several cards that can each be dirty.
 */

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { App as AntApp } from 'antd';
import { useTranslation } from 'react-i18next';

type Report = (key: string, dirty: boolean) => void;

const ReportContext = createContext<Report>(() => {});

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { modal } = AntApp.useApp();
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(() => new Set());

  const report = useCallback<Report>((key, dirty) => {
    setDirtyKeys((current) => {
      if (current.has(key) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const anyDirty = dirtyKeys.size > 0;

  // Only a move to another page loses the edits; a page rewriting its own query string does not.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => anyDirty && currentLocation.pathname !== nextLocation.pathname,
  );
  // The dialog follows the blocker's state, not its identity, so a re-render never reopens it.
  const blockerRef = useRef(blocker);
  useEffect(() => {
    blockerRef.current = blocker;
  });

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const dialog = modal.confirm({
      title: t('unsaved.title'),
      content: t('unsaved.content'),
      okText: t('unsaved.leave'),
      okButtonProps: { danger: true },
      cancelText: t('unsaved.stay'),
      onOk: () => blockerRef.current.proceed?.(),
      onCancel: () => blockerRef.current.reset?.(),
    });
    return () => dialog.destroy();
  }, [blocker.state, modal, t]);

  useEffect(() => {
    if (!anyDirty) return;
    function warn(event: BeforeUnloadEvent): void {
      event.preventDefault();
      // Older browsers only prompt when this is set; the text itself is never shown.
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  return <ReportContext.Provider value={report}>{children}</ReportContext.Provider>;
}

/** Tell the guard whether this component holds edits that are not saved yet. */
export function useReportUnsaved(dirty: boolean): void {
  const key = useId();
  const report = useContext(ReportContext);
  useEffect(() => {
    report(key, dirty);
    return () => report(key, false);
  }, [key, dirty, report]);
}

/**
 * Whether two form values hold the same data: key order and `undefined` fields do not count,
 * so a value read back from the server compares equal to the same value read from a form.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : inner,
  );
}
