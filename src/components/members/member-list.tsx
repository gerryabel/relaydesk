'use client';

import { useState, useTransition } from 'react';
import { updateMemberRoleAction } from '@/lib/members/actions';
import type { MemberDetail } from '@/lib/members/server';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';

type MemberListProps = {
  members: MemberDetail[];
  currentUserRole: 'owner' | 'member';
};

type RoleChangeState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
};

function formatJoinedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

function MemberRow({
  member,
  canManage,
}: {
  member: MemberDetail;
  canManage: boolean;
}) {
  const [roleState, setRoleState] = useState<RoleChangeState>({
    status: 'idle',
    message: null,
  });
  const [isPending, startTransition] = useTransition();

  const isOwner = member.role === 'owner';

  function handleRoleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextRole = event.target.value;
    if (nextRole === member.role) return;

    setRoleState({ status: 'idle', message: null });
    startTransition(async () => {
      const result = await updateMemberRoleAction(member.membershipId, {
        role: nextRole as 'owner' | 'member',
      });
      if (result.error) {
        setRoleState({ status: 'error', message: result.error });
      } else {
        setRoleState({ status: 'success', message: 'Role updated.' });
      }
    });
  }

  return (
    <li>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
          >
            {getInitials(member.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-50">
              {member.name}
            </p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {member.email}
            </p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              Joined {formatJoinedDate(member.joinedAt)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex items-center gap-2">
            <Badge tone={isOwner ? 'blue' : 'neutral'}>{member.role}</Badge>
            {member.isAssignable ? (
              <Badge tone="emerald">assignable</Badge>
            ) : (
              <Badge tone="neutral">not assignable</Badge>
            )}
          </div>

          {canManage ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor={`role-${member.membershipId}`}
                className="sr-only"
              >
                Change role for {member.name}
              </label>
              <Select
                id={`role-${member.membershipId}`}
                value={member.role}
                onChange={handleRoleChange}
                disabled={isPending}
              >
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </Select>
              {isPending ? (
                <span className="text-xs text-neutral-500">Saving…</span>
              ) : null}
            </div>
          ) : null}

          {roleState.message ? (
            <p
              role="status"
              className={
                roleState.status === 'error'
                  ? 'text-xs text-red-600 dark:text-red-400'
                  : 'text-xs text-emerald-600 dark:text-emerald-400'
              }
            >
              {roleState.message}
            </p>
          ) : null}
        </div>
      </Card>
    </li>
  );
}

export default function MemberList({ members, currentUserRole }: MemberListProps) {
  const canManage = currentUserRole === 'owner';

  return (
    <ul className="flex flex-col gap-3" aria-label="Workspace members">
      {members.map((member) => (
        <MemberRow
          key={member.membershipId}
          member={member}
          canManage={canManage}
        />
      ))}
    </ul>
  );
}
