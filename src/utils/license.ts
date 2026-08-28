import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

const STORAGE_KEY = "pos_license_config_v1";
const STORAGE_LICENSE_DATA_KEY = "pos_license_data_v1";
const DEVICE_ID_KEY = "pos_device_id_v1";

export type LicenseDeviceInfo = {
  pos_machine_id: string;
  os:             string;
  mac_address:    string;
};

export type LicensePayload = {
  key:         string;
  device_info: LicenseDeviceInfo;
  location:    string;
  branch_id:   string;
};

export type LicenseApiData = {
  key:           string;
  status:        string;
  expire_at?:    string;
  expire_date?:  string;
  activated_at?: string;
};

export type LicenseApiResponse = {
  status:  number;
  message: string;
  data?:   LicenseApiData;
};

export type LicenseResult =
  | { ok: true;  status: "valid";   message: string; data: LicenseApiData; raw?: any }
  | { ok: true;  status: "offline"; message: string }
  | { ok: false; status: "expired" | "inactive" | "invalid" | "error"; message: string; data?: LicenseApiData; raw?: any };

export const defaultOsString = () => {
  const version = typeof Platform.Version === "string" ? Platform.Version : String(Platform.Version ?? "");
  return `${Platform.OS} ${version}`.trim();
};

// Real hardware MAC addresses haven't been readable by apps since Android 6
// (every app gets back the same constant "02:00:00:00:00:00") and iOS never
// exposed one to begin with — so both device_info fields below are actually
// filled with the same locally-generated, SecureStore-persisted UUID rather
// than a genuine MAC. It's still stable for the life of this install (only
// changes on uninstall/reinstall), which is what the server actually needs
// this for: telling one activated device apart from another.
const getPersistentDeviceId = async (): Promise<string> => {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
};

export const buildDeviceInfo = async (): Promise<LicenseDeviceInfo> => {
  const id = await getPersistentDeviceId();
  return { pos_machine_id: id, os: defaultOsString(), mac_address: id };
};

export const loadLicenseConfig = async (): Promise<LicensePayload | null> => {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LicensePayload;
  } catch (e) {
    console.warn("[license] failed to load stored config", e);
    return null;
  }
};

export const loadLicenseData = async (): Promise<LicenseApiData | null> => {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_LICENSE_DATA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LicenseApiData;
  } catch {
    return null;
  }
};

export const saveLicenseConfig = async (config: LicensePayload): Promise<void> => {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(config));
};

export const clearLicenseConfig = async (): Promise<void> => {
  try { await SecureStore.deleteItemAsync(STORAGE_KEY); } catch {}
  try { await SecureStore.deleteItemAsync(STORAGE_LICENSE_DATA_KEY); } catch {}
};

type FetchJsonOptions = { timeoutMs?: number };

const fetchJson = async <T>(url: string, body: any, opts?: FetchJsonOptions): Promise<T> => {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { rawText: text };
    }

    if (!res.ok) {
      throw Object.assign(new Error(`HTTP ${res.status}`), { response: json, status: res.status });
    }
    return json as T;
  } finally {
    clearTimeout(timeout);
  }
};

const REGISTER_URL = "https://pos.superall.app/api/register";
const CHECK_URL    = "https://pos.superall.app/api/check";

const isOfflineError = (e: any) => {
  const name = e?.name;
  const message = String(e?.message || "");
  if (name === "AbortError") return true;
  if (message.toLowerCase().includes("network request failed")) return true;
  if (message.toLowerCase().includes("failed to fetch")) return true;
  return false;
};

const persistLicenseData = async (data?: LicenseApiData) => {
  if (!data) return;
  try { await SecureStore.setItemAsync(STORAGE_LICENSE_DATA_KEY, JSON.stringify(data)); } catch {}
};

const interpret = (json: LicenseApiResponse): LicenseResult => {
  const data = json?.data;
  if (!data?.key) {
    return { ok: false, status: "error", message: json?.message || "Invalid server response", raw: json };
  }

  const status = String(data.status || "").toLowerCase();
  if (status && status !== "active") {
    if (status === "expired") {
      return { ok: false, status: "expired", message: json?.message || "License expired", data, raw: json };
    }
    if (status === "inactive" || status === "disabled" || status === "blocked") {
      return { ok: false, status: "inactive", message: json?.message || `License status is ${data.status}`, data, raw: json };
    }
    return { ok: false, status: "invalid", message: json?.message || `License status is ${data.status}`, data, raw: json };
  }

  const expireAtIso = data.expire_at || data.expire_date;
  if (expireAtIso) {
    const ms = Date.parse(expireAtIso);
    if (Number.isFinite(ms) && ms < Date.now()) {
      return { ok: false, status: "expired", message: json?.message || "License expired", data, raw: json };
    }
  }

  return { ok: true, status: "valid", message: json?.message || "License valid", data, raw: json };
};

export const registerLicense = async (payload: LicensePayload): Promise<LicenseResult> => {
  console.log(`[license] register ${REGISTER_URL}`);
  try {
    const json = await fetchJson<LicenseApiResponse>(REGISTER_URL, payload);
    const result = interpret(json);
    await persistLicenseData((result as any).data);
    return result;
  } catch (e: any) {
    if (isOfflineError(e)) return { ok: true, status: "offline", message: "No internet connection" };
    const message = e?.response?.message || e?.message || "Registration failed";
    return { ok: false, status: "error", message, raw: e?.response };
  }
};

export const checkLicense = async (payload: LicensePayload): Promise<LicenseResult> => {
  console.log(`[license] check ${CHECK_URL}`);
  try {
    const json = await fetchJson<LicenseApiResponse>(CHECK_URL, payload);
    const result = interpret(json);
    await persistLicenseData((result as any).data);
    return result;
  } catch (e: any) {
    if (isOfflineError(e)) return { ok: true, status: "offline", message: "No internet connection" };
    const message = e?.response?.message || e?.message || "License check failed";
    return { ok: false, status: "error", message, raw: e?.response };
  }
};
