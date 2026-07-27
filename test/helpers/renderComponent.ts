/**
 * Minimal React render harness for the `node` test environment.
 *
 * The project has NO browser-test harness: vitest runs in `node`, there is no jsdom /
 * @testing-library / react-test-renderer, and no runtime UI deps may be added
 * (CLAUDE.md). This installs a hand-rolled dispatcher — the same primitive a real
 * renderer installs — so a function component can be *called* with working
 * useState/useRef/useCallback/useMemo/useEffect, re-rendered on a state update, and
 * walked as a plain element tree by `data-testid`. No DOM is touched.
 *
 * WHAT IT IS NOT: it does not commit, does not schedule, does not run cleanup
 * functions, and effects fire synchronously after every render rather than after
 * paint. It pins React-side WIRING — which handler calls which prop, what the tree
 * says after a state change. Live browser behaviour belongs in a Playwright spec.
 *
 * Inherited from SynthStack's presetPicker.test.ts, lifted out of that one test so
 * every later component test (Phases 3–6) can use it.
 */

import type { ReactElement, ReactNode } from 'react';
import * as React from 'react';

interface HookCell {
  value: unknown;
}

export interface RenderHandle {
  /** The current rendered tree (refreshed after every act()). */
  tree: ReactElement;
  /** Run a mutation (a fired handler) then re-render + flush effects, like a renderer. */
  act: (fn: () => void) => void;
}

const internals = (
  React as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      ReactCurrentDispatcher: { current: unknown };
    };
  }
).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

export function renderComponent<P>(
  Component: (props: P) => ReactElement,
  props: P,
): RenderHandle {
  const hooks: HookCell[] = [];
  const effects: Array<() => void> = [];
  let cursor = 0;
  let scheduleRerender: () => void = () => undefined;

  const dispatcher = {
    useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
      const i = cursor++;
      if (hooks[i] === undefined) {
        hooks[i] = { value: typeof initial === 'function' ? (initial as () => S)() : initial };
      }
      const cell = hooks[i]!;
      const setState = (next: S | ((prev: S) => S)) => {
        const prev = cell.value as S;
        cell.value = typeof next === 'function' ? (next as (p: S) => S)(prev) : next;
        scheduleRerender();
      };
      return [cell.value as S, setState];
    },
    useRef<T>(initial: T): { current: T } {
      const i = cursor++;
      if (hooks[i] === undefined) hooks[i] = { value: { current: initial } };
      return hooks[i]!.value as { current: T };
    },
    useCallback<T>(cb: T): T {
      const i = cursor++;
      hooks[i] = { value: cb };
      return cb;
    },
    useMemo<T>(factory: () => T): T {
      const i = cursor++;
      hooks[i] = { value: factory() };
      return hooks[i]!.value as T;
    },
    useEffect(effect: () => void): void {
      cursor++;
      effects.push(effect);
    },
    useLayoutEffect(effect: () => void): void {
      cursor++;
      effects.push(effect);
    },
  };

  let current!: ReactElement;
  const renderOnce = () => {
    cursor = 0;
    effects.length = 0;
    const prevDispatcher = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try {
      current = Component(props);
    } finally {
      internals.ReactCurrentDispatcher.current = prevDispatcher;
    }
    for (const e of effects) e();
  };

  scheduleRerender = renderOnce;
  renderOnce();

  return {
    get tree() {
      return current;
    },
    act(fn: () => void) {
      fn();
      // a state setter already calls scheduleRerender (synchronously re-rendering); ensure
      // at least one render so handlers that set no state still flush effects.
      renderOnce();
    },
  };
}

// ---------------------------------------------------------------------------------------
// Element-tree walking by data-testid + handler firing.
// ---------------------------------------------------------------------------------------

interface ElementProps {
  [key: string]: unknown;
  children?: ReactNode;
  'data-testid'?: string;
}

export function isElement(node: ReactNode): node is ReactElement {
  return typeof node === 'object' && node !== null && 'props' in node;
}

export function childrenOf(el: ReactElement): ReactNode[] {
  const kids = (el.props as ElementProps).children;
  if (kids === undefined || kids === null) return [];
  return (Array.isArray(kids) ? kids : [kids]) as ReactNode[];
}

/** Depth-first collect every element whose data-testid === id. */
export function findAllByTestId(
  root: ReactNode,
  id: string,
  out: ReactElement[] = [],
): ReactElement[] {
  if (!isElement(root)) return out;
  if ((root.props as ElementProps)['data-testid'] === id) out.push(root);
  for (const child of childrenOf(root)) findAllByTestId(child, id, out);
  return out;
}

export function findByTestId(root: ReactNode, id: string): ReactElement | undefined {
  return findAllByTestId(root, id)[0];
}

/** Depth-first collect every element whose data-testid matches a prefix. */
export function findByTestIdPrefix(
  root: ReactNode,
  prefix: string,
  out: ReactElement[] = [],
): ReactElement[] {
  if (!isElement(root)) return out;
  const tid = (root.props as ElementProps)['data-testid'];
  if (typeof tid === 'string' && tid.startsWith(prefix)) out.push(root);
  for (const child of childrenOf(root)) findByTestIdPrefix(child, prefix, out);
  return out;
}

/** Collect the text content under an element (string/number leaves only). */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!isElement(node)) return '';
  return childrenOf(node).map(textOf).join('');
}

export function prop<T = unknown>(el: ReactElement, name: string): T {
  return (el.props as ElementProps)[name] as T;
}
