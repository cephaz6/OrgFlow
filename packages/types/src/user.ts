import type { IsoDateTimeString, Uuid } from './common.js';

export type UserStatus = 'active' | 'disabled';

export interface User {
  userId: Uuid;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
  lastLoginAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}
