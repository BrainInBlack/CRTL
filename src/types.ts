/* Shared data-model and helper types used across the app. */

/** One clickable link on an entry. */
export interface Link {
  label: string;
  url: string;
}

/** A service row: icon, name, optional health check, and its links. */
export interface Entry {
  name: string;
  icon: string;
  check: boolean;
  links: Link[];
}

/** A named group of entries. */
export interface Group {
  group: string;
  entries: Entry[];
}

/** The whole persisted config (localStorage +, when synced, the gist). */
export interface Config {
  version: number;
  homeProbes: string[];
  groups: Group[];
  iconCache: Record<string, string>;
  /** Colour-blind friendly mode: health dots resolve to check/cross glyphs. */
  colorBlind: boolean;
}

/** Gist-sync credentials, stored locally in the clear. */
export interface SyncCreds {
  pat: string;
  gistId: string;
  key: string;
}

/** Detected (or manually locked) location. */
export type LocationState = 'home' | 'away';

/* ---- drag-and-drop (dnd.ts) ---- */

/** Captured geometry for a FLIP animation. */
export interface Rect {
  left: number;
  top: number;
  height: number;
}

/** A drop target: its container and the reorderable items inside it. */
export interface DragZone {
  container: HTMLElement;
  items: HTMLElement[];
}

/** Behavior for a single drag interaction. */
export interface DragOptions {
  resolve: (items: HTMLElement[], e: PointerEvent) => HTMLElement | null;
  getZones: () => DragZone[];
  onCommit: (item: HTMLElement, placeholder: HTMLElement) => void;
}
