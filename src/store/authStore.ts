import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usersRepo } from "../db/usersRepo";
import type { SessionUser } from "../types";

const USER_KEY = "pos_auth_user";

interface AuthStore {
  user:      SessionUser | null;
  isReady:   boolean;   // session restore from storage finished
  isLoading: boolean;
  error:     string | null;

  init:  () => Promise<void>;
  login: (name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user:      null,
  isReady:   false,
  isLoading: false,
  error:     null,

  init: async () => {
    const userJson = await AsyncStorage.getItem(USER_KEY);
    if (userJson) {
      try { set({ user: JSON.parse(userJson) }); } catch { /* corrupt cache — ignore */ }
    }
    set({ isReady: true });
  },

  login: async (name, password) => {
    set({ isLoading: true, error: null });
    try {
      const user = await usersRepo.login(name, password);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
      set({ user });
    } catch (e: any) {
      set({ error: "Invalid username or password" });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    await AsyncStorage.removeItem(USER_KEY);
    set({ user: null });
  },

  changePassword: async (currentPassword, newPassword) => {
    const { user } = get();
    if (!user) throw new Error("NOT_LOGGED_IN");
    await usersRepo.changePassword(user.id, currentPassword, newPassword);
  },
}));
