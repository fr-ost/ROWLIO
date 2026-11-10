// The extraction rule being built (shared by Visual Selector, Advanced Selectors and
// Pagination) and the spec chosen as "what to extract on every page".
import { create } from 'zustand';
import type { ExtractSpec, ExtractionRule, FieldRule, PaginationSettings } from '@/types';
import { uid } from '@/utils/id';

export const EMPTY_RULE: ExtractionRule = { rowSelector: '', rowSelectorType: 'css', fields: [] };

interface RuleState {
  rule: ExtractionRule;
  /** Where the rule came from: decides which editor "owns" it and the dataset's method. */
  origin: 'visual' | 'selectors';
  /** Number of records the picker / detector reported, for display. */
  matched: number | null;
  /** Page the rule was built on. */
  sourceUrl: string;
  /** What the Pagination screen should extract on each page. */
  paginationSpec: ExtractSpec | null;
  paginationLabel: string;
  /** Pagination settings loaded from a recipe (applied once by the Pagination screen). */
  recipePagination: PaginationSettings | null;
  setRule(rule: ExtractionRule, origin: 'visual' | 'selectors', meta?: { matched?: number | null; sourceUrl?: string }): void;
  patchRule(patch: Partial<ExtractionRule>): void;
  updateField(id: string, patch: Partial<FieldRule>): void;
  addField(field?: Partial<FieldRule>): void;
  removeField(id: string): void;
  moveField(id: string, delta: number): void;
  clear(): void;
  setPaginationSpec(spec: ExtractSpec | null, label: string, pagination?: PaginationSettings | null): void;
}

export const useRule = create<RuleState>((set, get) => ({
  rule: EMPTY_RULE,
  origin: 'selectors',
  matched: null,
  sourceUrl: '',
  paginationSpec: null,
  paginationLabel: '',
  recipePagination: null,

  setRule: (rule, origin, meta = {}) => set({ rule, origin, matched: meta.matched ?? null, sourceUrl: meta.sourceUrl ?? get().sourceUrl }),

  patchRule: (patch) => set({ rule: { ...get().rule, ...patch }, matched: null }),

  updateField: (id, patch) =>
    set({ rule: { ...get().rule, fields: get().rule.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)) } }),

  addField: (field = {}) => {
    const rule = get().rule;
    const next: FieldRule = {
      id: uid('f'),
      name: `Field ${rule.fields.length + 1}`,
      selector: '',
      selectorType: rule.rowSelectorType,
      extract: 'text',
      ...field,
    };
    set({ rule: { ...rule, fields: [...rule.fields, next] } });
  },

  removeField: (id) => set({ rule: { ...get().rule, fields: get().rule.fields.filter((field) => field.id !== id) } }),

  moveField: (id, delta) => {
    const fields = get().rule.fields.slice();
    const index = fields.findIndex((field) => field.id === id);
    const to = index + delta;
    if (index === -1 || to < 0 || to >= fields.length) return;
    const [item] = fields.splice(index, 1);
    fields.splice(to, 0, item);
    set({ rule: { ...get().rule, fields } });
  },

  clear: () => set({ rule: EMPTY_RULE, matched: null }),

  setPaginationSpec: (spec, label, pagination = null) => set({ paginationSpec: spec, paginationLabel: label, recipePagination: pagination }),
}));
