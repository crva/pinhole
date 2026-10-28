mod tray;
mod tunnel;

use std::{
    collections::HashMap,
    sync::{
        Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
};

use tunnel::{Problem, Proto, Tunnel, TunnelInfo};

#[derive(Default)]
struct AppState {
    next_id: AtomicU32,
    tunnels: Mutex<HashMap<u32, Tunnel>>,
    /// Set once quitting started: closes and exits then go through.
    quitting: AtomicBool,
}

impl AppState {
    fn tunnels(&self) -> MutexGuard<'_, HashMap<u32, Tunnel>> {
        self.tunnels.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn insert(&self, tunnel: Tunnel) -> TunnelInfo {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let info = tunnel.info(id);
        self.tunnels().insert(id, tunnel);
        info
    }
}

// Inputs (ports, share code, relay URL) are validated in `tunnel`.
// Errors reach the web view as `Problem`s ({ kind, detail }) that the UI translates.

/// `None` or empty: n0's public relays.
fn relay_of(relay: Option<&str>) -> Result<Option<iroh::RelayUrl>, Problem> {
    relay
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(tunnel::parse_relay)
        .transpose()
}

#[tauri::command]
async fn share(
    state: tauri::State<'_, AppState>,
    proto: Proto,
    port: u16,
    max_peers: usize,
    relay: Option<String>,
) -> Result<TunnelInfo, Problem> {
    let tunnel = tunnel::share(proto, port, max_peers, relay_of(relay.as_deref())?).await?;
    Ok(state.insert(tunnel))
}

#[tauri::command]
async fn join(
    state: tauri::State<'_, AppState>,
    ticket: String,
    local_port: Option<u16>,
    relay: Option<String>,
) -> Result<TunnelInfo, Problem> {
    let tunnel = tunnel::join(&ticket, local_port, relay_of(relay.as_deref())?).await?;
    Ok(state.insert(tunnel))
}

#[tauri::command]
async fn stop(state: tauri::State<'_, AppState>, id: u32) -> Result<(), String> {
    let tunnel = state.tunnels().remove(&id);
    if let Some(tunnel) = tunnel {
        tunnel.stop().await;
    }
    Ok(())
}

#[tauri::command]
fn list(state: tauri::State<'_, AppState>) -> Vec<TunnelInfo> {
    let mut infos: Vec<_> = state.tunnels().iter().map(|(id, t)| t.info(*id)).collect();
    infos.sort_by_key(|i| i.id);
    infos
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .manage(tray::TrayMenu::default())
        .setup(|app| {
            tray::setup(app.handle());
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            share,
            join,
            stop,
            list,
            tray::hide,
            tray::quit,
            tray::tray_labels
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(tray::on_run_event);
}
