/** Mirrors src-tauri/src/auth.rs AuthToken struct (v3 — Gitee-based) */
export interface AuthToken {
  access_token: string;
  display_id?: string;
  tier: string;
  device_limit: number;
  machine_code?: string;
}

/** Mirrors src-tauri/src/auth.rs ActivateData struct */
export interface ActivateResult {
  access_token: string;
  tier: string;
  device_limit: number;
  device_count: number;
}
