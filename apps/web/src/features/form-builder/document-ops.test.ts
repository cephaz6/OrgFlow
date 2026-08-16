import type { FormField, FormSection } from '@orgflow/types';
import { describe, expect, it } from 'vitest';

import {
  addField,
  keyFrom,
  moveFieldToSection,
  moveFieldWithinSection,
  moveSection,
  reorderFieldWithinSection,
  updateField,
} from './document-ops';

function field(key: string): FormField {
  return { key, type: 'text', label: key };
}

function section(key: string, fieldKeys: string[]): FormSection {
  return { key, title: key, fields: fieldKeys.map(field) };
}

describe('moveSection', () => {
  it('swaps a section one step towards the end', () => {
    const sections = [section('a', []), section('b', []), section('c', [])];
    const moved = moveSection(sections, 'a', 1);
    expect(moved.map((entry) => entry.key)).toEqual(['b', 'a', 'c']);
  });

  it('does nothing at the boundary', () => {
    const sections = [section('a', []), section('b', [])];
    expect(moveSection(sections, 'a', -1)).toBe(sections);
    expect(moveSection(sections, 'b', 1)).toBe(sections);
  });
});

describe('moveFieldWithinSection', () => {
  it('swaps a field one step towards the start', () => {
    const sections = [section('a', ['one', 'two', 'three'])];
    const moved = moveFieldWithinSection(sections, 'a', 'two', -1);
    expect(moved[0]!.fields.map((f) => f.key)).toEqual(['two', 'one', 'three']);
  });

  it('leaves other sections untouched', () => {
    const sections = [section('a', ['one']), section('b', ['two', 'three'])];
    const moved = moveFieldWithinSection(sections, 'b', 'two', 1);
    expect(moved[0]).toBe(sections[0]);
    expect(moved[1]!.fields.map((f) => f.key)).toEqual(['three', 'two']);
  });
});

describe('moveFieldToSection', () => {
  it('appends the field to the end of the target section and removes it from the source', () => {
    const sections = [section('a', ['one', 'two']), section('b', ['three'])];
    const moved = moveFieldToSection(sections, 'a', 'one', 'b');
    expect(moved[0]!.fields.map((f) => f.key)).toEqual(['two']);
    expect(moved[1]!.fields.map((f) => f.key)).toEqual(['three', 'one']);
  });

  it('is a no-op moving a field to its own section', () => {
    const sections = [section('a', ['one'])];
    expect(moveFieldToSection(sections, 'a', 'one', 'a')).toBe(sections);
  });
});

describe('reorderFieldWithinSection', () => {
  it('moves a field to an arbitrary index', () => {
    const sections = [section('a', ['one', 'two', 'three'])];
    const moved = reorderFieldWithinSection(sections, 'a', 0, 2);
    expect(moved[0]!.fields.map((f) => f.key)).toEqual(['two', 'three', 'one']);
  });
});

describe('addField and updateField', () => {
  it('appends a field to the named section', () => {
    const sections = [section('a', ['one'])];
    const added = addField(sections, 'a', field('two'));
    expect(added[0]!.fields.map((f) => f.key)).toEqual(['one', 'two']);
  });

  it('replaces a field in place without disturbing its position', () => {
    const sections = [section('a', ['one', 'two'])];
    const replaced = updateField(sections, 'a', 'one', { ...field('one'), label: 'Renamed' });
    expect(replaced[0]!.fields[0]).toEqual({ key: 'one', type: 'text', label: 'Renamed' });
    expect(replaced[0]!.fields[1]!.key).toBe('two');
  });
});

describe('keyFrom', () => {
  it('slugifies a label into a valid, unique key', () => {
    expect(keyFrom('Estimated Cost', [])).toBe('estimated_cost');
  });

  it('appends a numeric suffix on collision', () => {
    expect(keyFrom('Cost', ['cost', 'cost_2'])).toBe('cost_3');
  });

  it('never produces a key starting with a digit', () => {
    const key = keyFrom('123', []);
    expect(/^[a-zA-Z]/.test(key)).toBe(true);
  });
});
