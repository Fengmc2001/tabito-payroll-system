'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const unsaved = new Set<symbol>();
const pending = new Set<symbol>();

export type LeavePrompt = { blocked: boolean; resolve: (leave: boolean) => void };
let showPrompt: ((prompt: LeavePrompt) => void) | null = null;

export function subscribeLeavePrompt(listener: (prompt: LeavePrompt) => void) {
  showPrompt = listener;
  return () => { if (showPrompt === listener) showPrompt = null; };
}

export async function confirmPageLeave() {
  if (!pending.size && !unsaved.size) return true;
  if (!showPrompt) return false;
  return new Promise<boolean>((resolve) => showPrompt?.({ blocked: pending.size > 0, resolve }));
}

export function useUnsavedChanges(dirty: boolean, busy = false) {
  const token = useRef(Symbol('form'));
  useEffect(() => {
    const id = token.current;
    if (dirty) unsaved.add(id);
    if (busy) pending.add(id);
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      unsaved.delete(id);
      pending.delete(id);
      window.removeEventListener('beforeunload', leave);
    };
  }, [dirty, busy]);
}

export function useUploadTracker(upload?: (file: File) => Promise<string>) {
  const [count, setCount] = useState(0);
  const trackUpload = useCallback(async (file: File) => {
    setCount((value) => value + 1);
    try { return upload ? await upload(file) : file.name; }
    finally { setCount((value) => value - 1); }
  }, [upload]);
  return { uploading: count > 0, trackUpload };
}

export function useFeedback(initial = '') {
  const [state, setState] = useState({ message: initial, revision: 0 });
  const setMessage = useCallback((message: string) => {
    setState((current) => ({ message, revision: current.revision + 1 }));
  }, []);
  return [state.message, setMessage, state.revision] as const;
}

export function useModalFocus(onClose: () => void, busy = false) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const modal = ref.current;
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(modal.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
    )).filter((element) => element.getClientRects().length > 0 && !element.closest('fieldset:disabled'));
    (focusables()[0] ?? modal).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (!items.length || index === -1 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) : items[0])?.focus();
        if (!items.length) modal.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (!modal.contains(event.target as Node)) (focusables()[0] ?? modal).focus();
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      previous?.focus();
    };
  }, []);
  return ref;
}
