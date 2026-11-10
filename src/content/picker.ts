// Visual selector: point-and-click selection of repeated records and their fields, with
// a manual "two examples" fallback when no pattern is found automatically.
import type { ExtractKind, ExtractionRule, FieldRule } from '@/types';
import { t } from '@/i18n';
import { brand, IS_E2E } from '@/config/brand';
import { truncate, uniqueNames } from '@/utils/text';
import { inlineText, isElement, tagOf } from '@/extraction/dom';
import { detectFields, fieldForElement } from '@/extraction/fields';
import { uniqueSelector } from '@/extraction/generate';
import {
  findRecordGroup,
  groupFromExamples,
  narrowerGroup,
  widerGroup,
  type RecordGroup,
} from '@/extraction/patterns';
import { queryWithin, readValue } from '@/extraction/selectors';
import { guard, h, overlay } from './overlay';

type Mode = 'records' | 'element';
type Phase = 'pick' | 'second' | 'review' | 'add-field';

export interface PickerCallbacks {
  onRecords(rule: ExtractionRule, count: number): void;
  onElement(selector: string, text: string, purpose: string): void;
  onCancel(mode: Mode): void;
}

const BLOCKED_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick', 'contextmenu', 'submit', 'touchstart', 'touchend'];
const MAX_HIGHLIGHT = 200;
const EXTRACT_OPTIONS: [ExtractKind, string][] = [
  ['text', 'Text'],
  ['href', 'Link URL'],
  ['src', 'Image URL'],
  ['html', 'HTML'],
];

class Picker {
  private active = false;
  private mode: Mode = 'records';
  private purpose = '';
  private phase: Phase = 'pick';
  private callbacks: PickerCallbacks | null = null;
  private group: RecordGroup | null = null;
  private original: Element | null = null;
  private firstExample: Element | null = null;
  private selected: Element | null = null;
  private fields: FieldRule[] = [];
  private message = '';
  private hovered: Element | null = null;
  private dragging = false;
  private panel: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private footEl: HTMLElement | null = null;
  private unmount: (() => void) | null = null;

  get isActive(): boolean {
    return this.active;
  }

  start(mode: Mode, purpose: string, callbacks: PickerCallbacks): void {
    if (this.active) this.stop(false);
    this.active = true;
    this.mode = mode;
    this.purpose = purpose;
    this.callbacks = callbacks;
    this.phase = 'pick';
    this.group = null;
    this.original = null;
    this.firstExample = null;
    this.selected = null;
    this.fields = [];
    this.message = '';
    this.buildPanel();
    window.addEventListener('mousemove', this.onMove, true);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('keydown', this.onKey, true);
    for (const type of BLOCKED_EVENTS) window.addEventListener(type, this.onBlocked, true);
    this.render();
  }

  stop(notifyCancel: boolean): void {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('mousemove', this.onMove, true);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('keydown', this.onKey, true);
    for (const type of BLOCKED_EVENTS) window.removeEventListener(type, this.onBlocked, true);
    for (const key of ['hover', 'hover-group', 'records', 'field', 'selected']) overlay.clearBoxes(key);
    this.unmount?.();
    this.unmount = null;
    this.panel = null;
    const callbacks = this.callbacks;
    this.callbacks = null;
    if (notifyCancel) callbacks?.onCancel(this.mode);
  }

  // ---- events ------------------------------------------------------------------------

  private picking(): boolean {
    return this.phase === 'pick' || this.phase === 'second' || this.phase === 'add-field';
  }

  private targetOf(event: Event): Element | null {
    const first = event.composedPath()[0];
    const el = isElement(first as Node) ? (first as Element) : ((first as Node)?.parentElement ?? null);
    if (!el) return null;
    const tag = tagOf(el);
    return tag === 'HTML' || tag === 'BODY' ? null : el;
  }

  private readonly onMove = (event: MouseEvent) => {
    if (!this.picking() || this.dragging) return;
    if (overlay.ownsEvent(event)) {
      this.setHover(null);
      return;
    }
    this.setHover(this.targetOf(event));
  };

  private readonly onBlocked = (event: Event) => {
    if (!this.picking() || overlay.ownsEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly onClick = (event: MouseEvent) => {
    if (!this.picking() || overlay.ownsEvent(event)) return;
    // The click is ours: never let the page navigate or react to it.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.isTrusted && !IS_E2E) return;
    const target = this.targetOf(event);
    if (target) this.handlePick(target);
  };

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.phase === 'add-field') {
      this.phase = 'review';
      this.setHover(null);
      this.render();
    } else {
      this.stop(true);
    }
  };

  private setHover(el: Element | null): void {
    if (el === this.hovered) return;
    this.hovered = el;
    if (!el) {
      overlay.clearBoxes('hover');
      overlay.clearBoxes('hover-group');
      return;
    }
    if (this.mode === 'records' && this.phase === 'pick') {
      let group: RecordGroup | null = null;
      try {
        group = findRecordGroup(el);
      } catch {
        group = null;
      }
      overlay.setBoxes('hover-group', group ? group.elements.slice(0, MAX_HIGHLIGHT) : [], 'record');
      overlay.setBoxes('hover', [el], 'hover');
    } else if (this.phase === 'add-field') {
      const inRecord = this.group?.elements.some((record) => record.contains(el));
      overlay.setBoxes('hover', inRecord ? [el] : [], 'field');
    } else {
      overlay.setBoxes('hover', [el], 'hover');
    }
  }

  // ---- state transitions ---------------------------------------------------------------

  private handlePick(target: Element): void {
    this.message = '';
    if (this.mode === 'element') {
      this.selected = target;
      this.phase = 'review';
      this.setHover(null);
      overlay.setBoxes('selected', [target], 'record');
      this.render();
      return;
    }
    if (this.phase === 'pick') {
      this.original = target;
      let group: RecordGroup | null = null;
      try {
        group = findRecordGroup(target);
      } catch {
        group = null;
      }
      if (!group) {
        this.firstExample = target;
        this.phase = 'second';
        this.setHover(null);
        overlay.setBoxes('selected', [target], 'record');
        this.render();
        return;
      }
      this.applyGroup(group);
      return;
    }
    if (this.phase === 'second' && this.firstExample) {
      const group = groupFromExamples(this.firstExample, target);
      if (!group) {
        this.message = t('Those two elements do not share a repeating pattern. Try two items from the same list.');
        this.render();
        return;
      }
      this.original = this.firstExample;
      this.applyGroup(group);
      return;
    }
    if (this.phase === 'add-field' && this.group) {
      const record = this.group.elements.find((el) => el.contains(target));
      if (!record) return;
      const field = fieldForElement(record, target, this.group.elements, document);
      const duplicate = this.fields.some((existing) => existing.selector === field.selector && existing.extract === field.extract && existing.attribute === field.attribute);
      if (duplicate) {
        this.message = t('That element is already a field.');
      } else {
        this.fields.push(field);
        this.renameUnique();
      }
      this.render();
    }
  }

  private applyGroup(group: RecordGroup): void {
    this.group = group;
    try {
      this.fields = detectFields(group.elements, document);
    } catch {
      this.fields = [];
    }
    if (this.fields.length === 0) {
      this.message = t('No fields were detected automatically. Use "Add field by clicking" to choose them yourself.');
    }
    this.phase = 'review';
    this.setHover(null);
    overlay.clearBoxes('selected');
    overlay.setBoxes('records', group.elements.slice(0, MAX_HIGHLIGHT), 'record');
    this.render();
  }

  private useSingleElement(): void {
    if (!this.firstExample) return;
    const el = this.firstExample;
    this.original = el;
    this.applyGroup({ anchor: el, elements: [el], selector: uniqueSelector(el) });
  }

  private renameUnique(): void {
    const names = uniqueNames(this.fields.map((field) => field.name), t('Field'));
    this.fields.forEach((field, i) => (field.name = names[i]));
  }

  private finish(): void {
    if (this.mode === 'element') {
      if (!this.selected) return;
      const selector = uniqueSelector(this.selected);
      const text = truncate(inlineText(this.selected), 120);
      const callbacks = this.callbacks;
      const purpose = this.purpose;
      this.stop(false);
      callbacks?.onElement(selector, text, purpose);
      return;
    }
    if (!this.group || this.fields.length === 0) {
      this.message = t('Add at least one field first.');
      this.render();
      return;
    }
    this.renameUnique();
    const rule: ExtractionRule = {
      rowSelector: this.group.selector,
      rowSelectorType: 'css',
      fields: this.fields.map((field) => ({ ...field })),
    };
    const count = this.group.elements.length;
    const callbacks = this.callbacks;
    this.stop(false);
    callbacks?.onRecords(rule, count);
  }

  // ---- rendering -----------------------------------------------------------------------

  private buildPanel(): void {
    const title = this.mode === 'records' ? t('Visual selector') : t('Select an element');
    const head = h(
      'div',
      { class: 'panel-head' },
      h('span', { class: 'logo', 'aria-hidden': 'true' }),
      h('span', { class: 'panel-title' }, `${brand.name} · ${title}`),
      h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': t('Close'), title: t('Close (Esc)'), 'data-rowlio': 'picker-close', onClick: guard(() => this.stop(true)) }, '✕'),
    );
    head.addEventListener('mousedown', (event) => this.startDrag(event as MouseEvent));
    this.bodyEl = h('div', { class: 'panel-body' });
    this.footEl = h('div', { class: 'panel-foot' });
    this.panel = h('section', { class: 'panel', role: 'dialog', 'aria-label': `${brand.name} ${title}`, 'data-rowlio': 'picker' }, head, this.bodyEl, this.footEl);
    this.unmount = overlay.mount(this.panel);
  }

  private startDrag(event: MouseEvent): void {
    const panel = this.panel;
    if (!panel || (event.target as Element)?.closest?.('button')) return;
    const rect = panel.getBoundingClientRect();
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    this.dragging = true;
    const move = (e: MouseEvent) => {
      const left = Math.min(Math.max(0, e.clientX - dx), window.innerWidth - 60);
      const top = Math.min(Math.max(0, e.clientY - dy), window.innerHeight - 40);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };
    const up = () => {
      this.dragging = false;
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
    event.preventDefault();
  }

  private sampleFor(field: FieldRule): string {
    if (!this.group) return '';
    for (const record of this.group.elements.slice(0, 6)) {
      try {
        const outcome = queryWithin(record, field.selector, field.selectorType, document);
        if (outcome.nodes.length === 0) continue;
        const value = field.multiple
          ? outcome.nodes.map((node) => readValue(node, field.extract, field.attribute)).filter(Boolean).join(field.joinWith ?? ', ')
          : readValue(outcome.nodes[0], field.extract, field.attribute);
        if (value) return truncate(value.replace(/\s+/g, ' '), 90);
      } catch {
        /* invalid selector: no sample */
      }
    }
    return '';
  }

  private highlightField(field: FieldRule | null): void {
    if (!field || !this.group) {
      overlay.clearBoxes('field');
      return;
    }
    const matches: Element[] = [];
    for (const record of this.group.elements.slice(0, MAX_HIGHLIGHT)) {
      try {
        for (const node of queryWithin(record, field.selector, field.selectorType, document).nodes) {
          if (isElement(node)) matches.push(node);
        }
      } catch {
        /* ignore */
      }
    }
    overlay.setBoxes('field', matches, 'field');
  }

  private fieldRow(field: FieldRule, index: number): HTMLElement {
    const sample = h('div', { class: 'field-sample', title: t('Sample value') }, this.sampleFor(field) || t('(empty in the first records)'));
    const name = h('input', {
      type: 'text',
      value: field.name,
      'aria-label': t('Field name'),
      'data-rowlio': 'field-name',
      onInput: (event: Event) => {
        field.name = (event.target as HTMLInputElement).value;
      },
    });
    const kind = h(
      'select',
      {
        'aria-label': t('What to extract'),
        onChange: (event: Event) => {
          field.extract = (event.target as HTMLSelectElement).value as ExtractKind;
          if (field.extract !== 'attr') delete field.attribute;
          sample.textContent = this.sampleFor(field) || t('(empty in the first records)');
        },
      },
      ...EXTRACT_OPTIONS.map(([value, label]) => {
        const option = h('option', { value }, t(label));
        if (value === field.extract) option.selected = true;
        return option;
      }),
      field.extract === 'attr' ? (() => {
        const option = h('option', { value: 'attr' }, `@${field.attribute ?? ''}`);
        option.selected = true;
        return option;
      })() : null,
    );
    const move = (delta: number) => {
      const to = index + delta;
      if (to < 0 || to >= this.fields.length) return;
      const [item] = this.fields.splice(index, 1);
      this.fields.splice(to, 0, item);
      this.render();
    };
    const row = h(
      'li',
      { class: 'field', 'data-rowlio': 'field' },
      h(
        'div',
        { class: 'row' },
        name,
        kind,
        h('button', { class: 'btn btn-icon', type: 'button', title: t('Move up'), 'aria-label': t('Move field up'), disabled: index === 0, onClick: guard(() => move(-1)) }, '↑'),
        h('button', { class: 'btn btn-icon', type: 'button', title: t('Move down'), 'aria-label': t('Move field down'), disabled: index === this.fields.length - 1, onClick: guard(() => move(1)) }, '↓'),
        h('button', {
          class: 'btn btn-icon',
          type: 'button',
          title: t('Remove field'),
          'aria-label': t('Remove field'),
          'data-rowlio': 'field-remove',
          onClick: guard(() => {
            this.fields.splice(index, 1);
            this.highlightField(null);
            this.render();
          }),
        }, '✕'),
      ),
      sample,
    );
    row.addEventListener('mouseenter', () => this.highlightField(field));
    row.addEventListener('mouseleave', () => this.highlightField(null));
    row.addEventListener('focusin', () => this.highlightField(field));
    row.addEventListener('focusout', () => this.highlightField(null));
    return row;
  }

  private render(): void {
    const body = this.bodyEl;
    const foot = this.footEl;
    if (!body || !foot) return;
    const nodes: (Node | null)[] = [];
    const cancel = h('button', { class: 'btn', type: 'button', 'data-rowlio': 'picker-cancel', onClick: guard(() => this.stop(true)) }, t('Cancel'));
    let primary: HTMLElement | null = null;

    if (this.mode === 'element') {
      if (this.phase === 'pick' || !this.selected) {
        nodes.push(h('p', { class: 'hint' }, t('Click the {purpose} on the page.', { purpose: this.purpose || t('element') })));
      } else {
        const selected = this.selected;
        const parent = selected.parentElement;
        nodes.push(
          h('div', { class: 'notice' }, truncate(inlineText(selected) || `<${selected.tagName.toLowerCase()}>`, 140)),
          h('div', { class: 'selector', 'data-rowlio': 'element-selector' }, uniqueSelector(selected)),
          h(
            'div',
            { class: 'row' },
            h('button', {
              class: 'btn',
              type: 'button',
              disabled: !parent || tagOf(parent) === 'BODY' || tagOf(parent) === 'HTML',
              onClick: guard(() => {
                if (parent) this.handlePick(parent);
              }),
            }, t('Select parent')),
            h('button', {
              class: 'btn',
              type: 'button',
              onClick: guard(() => {
                this.selected = null;
                this.phase = 'pick';
                overlay.clearBoxes('selected');
                this.render();
              }),
            }, t('Pick again')),
          ),
        );
        primary = h('button', { class: 'btn btn-primary', type: 'button', 'data-rowlio': 'picker-done', onClick: guard(() => this.finish()) }, t('Use this element'));
      }
    } else if (this.phase === 'pick') {
      nodes.push(
        h('p', { class: 'hint' }, t('Click one item of the list you want — for example one product card or one search result. {name} finds the similar items automatically.', { name: brand.name })),
      );
    } else if (this.phase === 'second') {
      nodes.push(
        h('div', { class: 'notice notice-warn' }, t('No repeating pattern was found around that element.')),
        h('p', { class: 'hint' }, t('Click a second item of the same kind and {name} will generalise from the two examples.', { name: brand.name })),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', 'data-rowlio': 'use-single', onClick: guard(() => this.useSingleElement()) }, t('Use only this element'))),
      );
    } else if (this.group) {
      const group = this.group;
      const wider = safe(() => widerGroup(group.anchor));
      const narrower = this.original ? safe(() => narrowerGroup(group.anchor, this.original!)) : null;
      const adding = this.phase === 'add-field';
      nodes.push(
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'count grow', 'data-rowlio': 'record-count' }, group.elements.length === 1 ? t('1 record selected') : t('{count} records selected', { count: group.elements.length })),
          h('button', { class: 'btn', type: 'button', title: t('Select a larger repeating block'), disabled: !wider, 'data-rowlio': 'wider', onClick: guard(() => wider && this.applyGroup(wider)) }, t('Wider')),
          h('button', { class: 'btn', type: 'button', title: t('Select a smaller repeating block'), disabled: !narrower, 'data-rowlio': 'narrower', onClick: guard(() => narrower && this.applyGroup(narrower)) }, t('Narrower')),
          h('button', {
            class: 'btn',
            type: 'button',
            onClick: guard(() => {
              this.phase = 'pick';
              this.group = null;
              this.fields = [];
              overlay.clearBoxes('records');
              this.render();
            }),
          }, t('Re-pick')),
        ),
        h('div', { class: 'selector', title: t('Row selector') }, group.selector),
        h('div', { class: 'section-label' }, t('Fields ({count})', { count: this.fields.length })),
        h('ul', { class: 'fields' }, ...this.fields.map((field, index) => this.fieldRow(field, index))),
        adding ? h('div', { class: 'notice' }, t('Click any element inside a highlighted record to add it as a field. Press Esc when done.')) : null,
        h(
          'div',
          { class: 'row' },
          h('button', {
            class: adding ? 'btn btn-active' : 'btn',
            type: 'button',
            'aria-pressed': adding ? 'true' : 'false',
            'data-rowlio': 'add-field',
            onClick: guard(() => {
              this.phase = adding ? 'review' : 'add-field';
              this.setHover(null);
              this.render();
            }),
          }, adding ? t('Done adding') : t('+ Add field by clicking')),
        ),
      );
      primary = h(
        'button',
        { class: 'btn btn-primary', type: 'button', disabled: this.fields.length === 0, 'data-rowlio': 'picker-done', onClick: guard(() => this.finish()) },
        group.elements.length === 1 ? t('Use 1 record') : t('Use {count} records', { count: group.elements.length }),
      );
    }
    if (this.message) nodes.splice(1, 0, h('div', { class: 'notice notice-warn', role: 'alert' }, this.message));
    body.replaceChildren(...nodes.filter((node): node is Node => node !== null));
    foot.replaceChildren(cancel, ...(primary ? [primary] : []));
  }
}

function safe<T>(fn: () => T | null): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export const picker = new Picker();
