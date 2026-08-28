import { getDb, hashPassword } from "./database";
import type { Role, SessionUser, UserAccount } from "../types";

interface UserRow {
  id:            number;
  name:          string;
  password_hash: string;
  role:          string;
  is_active:     number;
}

const toUserAccount = (r: UserRow): UserAccount => ({
  id:       r.id,
  name:     r.name,
  role:     r.role as Role,
  isActive: !!r.is_active,
});

export class DuplicateUserNameError extends Error {
  constructor(name: string) { super(`DUPLICATE_USER_NAME:${name}`); }
}

export const usersRepo = {
  login: async (name: string, password: string): Promise<SessionUser> => {
    const db = await getDb();
    const row = await db.getFirstAsync<UserRow>(
      "SELECT * FROM users WHERE name = ?",
      [name]
    );
    if (!row || !row.is_active) throw new Error("INVALID_CREDENTIALS");

    const hash = await hashPassword(password);
    if (hash !== row.password_hash) throw new Error("INVALID_CREDENTIALS");

    return { id: row.id, name: row.name, role: row.role as Role };
  },

  changePassword: async (userId: number, currentPassword: string, newPassword: string) => {
    const db = await getDb();
    const row = await db.getFirstAsync<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
    if (!row) throw new Error("USER_NOT_FOUND");

    const currentHash = await hashPassword(currentPassword);
    if (currentHash !== row.password_hash) throw new Error("WRONG_CURRENT_PASSWORD");

    const newHash = await hashPassword(newPassword);
    await db.runAsync("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, userId]);
  },

  getAll: async (): Promise<UserAccount[]> => {
    const db = await getDb();
    const rows = await db.getAllAsync<UserRow>("SELECT * FROM users ORDER BY name");
    return rows.map(toUserAccount);
  },

  countActiveAdmins: async (): Promise<number> => {
    const db = await getDb();
    const row = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM users WHERE role = 'Admin' AND is_active = 1"
    );
    return row?.count ?? 0;
  },

  createUser: async (name: string, password: string, role: Role): Promise<UserAccount> => {
    const db = await getDb();
    const existing = await db.getFirstAsync<{ id: number }>("SELECT id FROM users WHERE name = ?", [name]);
    if (existing) throw new DuplicateUserNameError(name);

    const hash = await hashPassword(password);
    const { lastInsertRowId } = await db.runAsync(
      "INSERT INTO users (name, password_hash, role, is_active) VALUES (?, ?, ?, 1)",
      [name, hash, role]
    );
    return { id: lastInsertRowId, name, role, isActive: true };
  },

  setRole: async (userId: number, role: Role) => {
    const db = await getDb();
    await db.runAsync("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
  },

  setActive: async (userId: number, isActive: boolean) => {
    const db = await getDb();
    await db.runAsync("UPDATE users SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, userId]);
  },

  resetPassword: async (userId: number, newPassword: string) => {
    const db = await getDb();
    const hash = await hashPassword(newPassword);
    await db.runAsync("UPDATE users SET password_hash = ? WHERE id = ?", [hash, userId]);
  },

  deleteUser: async (userId: number) => {
    const db = await getDb();
    await db.runAsync("DELETE FROM users WHERE id = ?", [userId]);
  },
};
