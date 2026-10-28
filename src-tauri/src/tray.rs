//! Closing the window and the tray icon.
//!
//! Closing the main window doesn't quit: the web view is asked what to do (keep
//! running in the tray, or quit), following the user's saved choice or a dialog.
//! The tray icon is always there while the app runs: left click shows the window,
//! right click opens a menu to show it or quit. Quitting stops every tunnel first,
//! so the other side is told right away instead of waiting for a timeout.

use std::{
    sync::{Mutex, atomic::Ordering},
    time::Duration,
};

use tauri::{
    AppHandle, Emitter, Manager, RunEvent, Window, WindowEvent, Wry,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tokio::task::JoinSet;

use crate::AppState;

/// Sent to the web view when the user closes the main window.
const CLOSE_REQUESTED: &str = "close-requested";
/// Stopping a tunnel tells its peers; one that can't be reached must not hold the exit.
const QUIT_TIMEOUT: Duration = Duration::from_secs(3);

/// The tray menu entries, kept to translate them (`tray_labels`).
#[derive(Default)]
pub(crate) struct TrayMenu(Mutex<Option<(MenuItem<Wry>, MenuItem<Wry>)>>);

pub(crate) fn setup(app: &AppHandle) {
    // Without a tray (e.g. no indicator support on Linux) the app still works:
    // "keep running" then minimizes the window instead (see `hide`).
    if let Err(e) = build_tray(app) {
        eprintln!("tray icon unavailable: {e}");
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Pinhole", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Pinhole", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Pinhole")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    *app.state::<TrayMenu>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some((show, quit));
    Ok(())
}

/// `on_window_event`: a close becomes a question for the web view.
pub(crate) fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event
        && !window.state::<AppState>().quitting.load(Ordering::SeqCst)
    {
        api.prevent_close();
        let _ = window.emit(CLOSE_REQUESTED, ());
    }
}

/// `run` callback: an exit from elsewhere (e.g. Cmd+Q on macOS) still stops the tunnels first.
pub(crate) fn on_run_event(app: &AppHandle, event: RunEvent) {
    if let RunEvent::ExitRequested { api, .. } = event
        && !app.state::<AppState>().quitting.load(Ordering::SeqCst)
    {
        api.prevent_exit();
        quit_app(app);
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Stops every tunnel, then exits. The window disappears at once.
fn quit_app(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let tunnels: Vec<_> = state.tunnels().drain().map(|(_, tunnel)| tunnel).collect();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut stops = JoinSet::new();
        for tunnel in tunnels {
            stops.spawn(tunnel.stop());
        }
        let _ = tokio::time::timeout(QUIT_TIMEOUT, stops.join_all()).await;
        app.exit(0);
    });
}

/// Keeps the app running in the tray: hides the main window (minimizes it without a tray).
#[tauri::command]
pub(crate) fn hide(app: AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = if app.tray_by_id("main").is_some() {
        window.hide()
    } else {
        window.minimize()
    };
}

/// Stops every tunnel and exits.
#[tauri::command]
pub(crate) fn quit(app: AppHandle) {
    quit_app(&app);
}

/// The tray menu in the UI's language.
#[tauri::command]
pub(crate) fn tray_labels(menu: tauri::State<'_, TrayMenu>, show: String, quit: String) {
    if let Some((show_item, quit_item)) = &*menu.0.lock().unwrap_or_else(|e| e.into_inner()) {
        let _ = show_item.set_text(show);
        let _ = quit_item.set_text(quit);
    }
}
