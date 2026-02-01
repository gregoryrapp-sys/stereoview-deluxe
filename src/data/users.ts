export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  password: string;
}

export const users: User[] = [
  {
    id: 'admin',
    name: 'Stereo Admin',
    username: 'admin',
    role: 'admin',
    password: 'admin123',
  },
  {
    id: 'u1',
    name: 'Casey Park',
    username: 'casey',
    role: 'user',
    password: 'casey123',
  },
  {
    id: 'u2',
    name: 'Riley Soto',
    username: 'riley',
    role: 'user',
    password: 'riley123',
  },
];
