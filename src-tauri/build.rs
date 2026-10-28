fn main() {
    // Declaring the app commands makes them subject to capabilities like plugin commands:
    // a window can only call those its capability allows (see capabilities/default.json).
    let manifest =
        tauri_build::AppManifest::new().commands(&["share", "join", "stop", "list", "hide", "quit", "tray_labels"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("failed to run tauri-build");
}
