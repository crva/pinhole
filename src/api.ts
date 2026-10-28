import { invoke } from "@tauri-apps/api/core";
import { getRelay } from "@/lib/settings";

export type Proto = "tcp" | "udp";

/** Highest joiner limit of a share: mirrors `MAX_PEERS` in src-tauri/src/tunnel.rs. */
export const MAX_PEERS = 16;

/** Mirrors the structs in src-tauri/src/tunnel.rs. */
export interface Traffic {
  tx_bytes: number;
  rx_bytes: number;
  tx_packets: number;
  rx_packets: number;
}

export interface ConnInfo {
  remote_id: string;
  path: "direct" | "relay";
  rtt_ms: number | null;
  direct_addr: string | null;
  relay: string | null;
  relay_bytes: number;
  traffic: Traffic;
}

export type Phase = "waiting" | "connecting" | "connected" | "reconnecting" | "failed";

/** Why `share` / `join` refused to start (rejected invoke). */
export type SetupErrorKind =
  | "invalid_port"
  | "invalid_limit"
  | "invalid_code"
  | "invalid_relay"
  | "port_in_use"
  | "port_denied"
  | "relay_unreachable"
  | "network";

/** Why a connection attempt failed (`TunnelInfo.problem`). */
export type FailureKind = "no_direct" | "unreachable" | "wrong_code" | "full" | "timeout" | "closed" | "relay_path";

/** `detail`: technical detail (English) or the value at fault, e.g. the port. */
export interface Problem<K = SetupErrorKind | FailureKind> {
  kind: K;
  detail?: string;
}

export interface TunnelInfo {
  id: number;
  role: "share" | "join";
  proto: Proto;
  port: number;
  ticket: string | null;
  phase: Phase;
  /** Joiner: why it failed or is retrying. Host: why the last attempt failed. */
  problem: Problem<FailureKind> | null;
  peers: number;
  /** Host: joiners allowed at once. */
  max_peers: number | null;
  /** Host: right-code joiners turned away because the share was full. */
  refused: number;
  path: "direct" | "relay" | "none";
  rtt_ms: number | null;
  home_relay: string | null;
  traffic: Traffic;
  uptime_secs: number;
  connections: ConnInfo[];
}

export const api = {
  // The relay setting applies to new tunnels; null means iroh's default relays.
  share: (proto: Proto, port: number, maxPeers: number) =>
    invoke<TunnelInfo>("share", { proto, port, maxPeers, relay: getRelay() }),
  join: (ticket: string, localPort: number | null) =>
    invoke<TunnelInfo>("join", { ticket, localPort, relay: getRelay() }),
  stop: (id: number) => invoke<void>("stop", { id }),
  list: () => invoke<TunnelInfo[]>("list"),
  /** Keeps the app running in the tray (hides the window). */
  hide: () => invoke<void>("hide"),
  /** Stops every tunnel and exits. */
  quit: () => invoke<void>("quit"),
  trayLabels: (show: string, quit: string) => invoke<void>("tray_labels", { show, quit }),
};
