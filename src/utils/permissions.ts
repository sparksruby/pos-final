import type { Role, SessionUser } from "../types";

export const ROLES: Role[] = ["Admin", "Cashier"];

export const isAdmin = (user: SessionUser | null): boolean => user?.role === "Admin";
