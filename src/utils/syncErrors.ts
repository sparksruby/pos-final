import { SyncError } from "../db/syncRepo";
import type { TranslationKey } from "../i18n/translations";

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

// Maps a SyncError thrown by an admin-create call (branch/device) to a
// user-facing message — the raw messages are internal codes or raw HTTP
// response bodies, not meant to be shown to a cashier/admin as-is.
export const syncErrorMessage = (e: SyncError, t: T): string => {
  if (e.message === "NOT_CONNECTED") return t("sync.notConnectedError");
  if (e.message === "NO_ADMIN_KEY") return t("sync.noAdminKeyError");
  if (e.message === "NETWORK_ERROR") return t("sync.networkError");
  if (e.message === "BRANCH_NOT_SYNCED") return t("registerDevice.branchNotSyncedError");
  if (e.status === 401) return t("sync.adminKeyInvalid");
  return e.message;
};
