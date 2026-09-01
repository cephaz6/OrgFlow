'use client';

import type { OrganisationRole } from '@orgflow/types';
import { Input, Label, Select } from '@orgflow/ui';
import { useId } from 'react';

import type { SimulationContextInput } from './simulate';

// Mirrors packages/types/src/membership.ts's OrganisationRole, which is a
// type rather than a runtime value, the same reason step-panel.tsx spells
// its own copy out.
const ORGANISATION_ROLES: OrganisationRole[] = [
  'member',
  'approver',
  'processOwner',
  'admin',
  'owner',
];

export interface ContextPanelProps {
  value: SimulationContextInput;
  disabled: boolean;
  onChange: (value: SimulationContextInput) => void;
}

// ADR-0040: these are hypothetical, not facts about the signed-in user. The
// question a simulation answers is "what happens to someone like this",
// so the requester is described here rather than looked up.
export function ContextPanel({ value, disabled, onChange }: ContextPanelProps) {
  const idPrefix = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-department`}>Requester's department</Label>
        <Input
          id={`${idPrefix}-department`}
          disabled={disabled}
          placeholder="Leave blank for none"
          value={value.department ?? ''}
          onChange={(event) => onChange({ ...value, department: event.target.value || null })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-role`}>Requester's role</Label>
        <Select
          id={`${idPrefix}-role`}
          disabled={disabled}
          value={value.roles[0] ?? 'member'}
          onChange={(event) =>
            onChange({ ...value, roles: [event.target.value as OrganisationRole] })
          }
        >
          {ORGANISATION_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </Select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          disabled={disabled}
          checked={value.hasLineManager}
          onChange={(event) => onChange({ ...value, hasLineManager: event.target.checked })}
        />
        The requester has a line manager
      </label>
      {!value.hasLineManager ? (
        <p className="text-xs text-muted-foreground">
          A step assigned to the line manager cannot resolve, so the request will stall as
          unassigned. That is the point of the toggle.
        </p>
      ) : null}
    </div>
  );
}
