#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
use hex;
use pcsc::*;
use tauri::{Emitter, Manager, WebviewWindow};

// Function to get UID from the card
fn get_uid(card: &Card) -> Option<String> {
    let apdu_get_uid: [u8; 5] = [0xFF, 0xCA, 0x00, 0x00, 0x00];
    let mut buf: [u8; 40] = [0; 40];
    match card.transmit(&apdu_get_uid, &mut buf) {
        Ok(response) if response.len() > 2 => {
            // response is &[u8], exclude last 2 bytes (SW1 SW2)
            Some(hex::encode(&response[..response.len() - 2]))
        }
        _ => None,
    }
}

// Start background NFC listener
fn start_nfc_listener(window: WebviewWindow) -> Result<(), String> {
    use pcsc::{Context, Disposition, Protocols, ReaderState, ShareMode, State};
    use std::thread;
    use std::time::Duration;

    thread::spawn(move || {
        let mut last_uid = String::new();
        let mut card_present = false; // track card state

        loop {
            let ctx = match Context::establish(pcsc::Scope::User) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Failed to establish context: {}", e);
                    let _ = window.emit("nfc-error", format!("Context error: {}", e));
                    thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };

            let mut buf = [0u8; 2048];
            let reader = match ctx.list_readers(&mut buf) {
                Ok(mut readers) => {
                    if let Some(r) = readers.next() {
                        r.to_owned()
                    } else {
                        eprintln!("No NFC readers found");
                        let _ = window.emit("nfc-error", "No NFC readers found");
                        thread::sleep(Duration::from_secs(5));
                        continue;
                    }
                }
                Err(e) => {
                    eprintln!("Failed to list readers: {}", e);
                    thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };

            let mut states = [ReaderState::new(&*reader, State::UNAWARE)];

            loop {
                if let Err(e) = ctx.get_status_change(Some(Duration::from_millis(500)), &mut states)
                {
                    eprintln!("Status change error: {:?}", e);
                    thread::sleep(Duration::from_secs(1));
                    continue;
                }

                let state = states[0].event_state();

                if state.contains(State::PRESENT) {
                    // Only try to connect if card just became present
                    if !card_present {
                        card_present = true;

                        match ctx.connect(&reader, ShareMode::Shared, Protocols::ANY) {
                            Ok(card) => {
                                if let Some(uid) = get_uid(&card) {
                                    if uid != last_uid {
                                        last_uid = uid.clone();
                                        println!("Scanned UID: {}", uid);
                                        let _ = window.emit("nfc-scanned", uid.clone());
                                    }
                                }
                                let _ = card.disconnect(Disposition::LeaveCard);
                            }
                            Err(e) => eprintln!("Failed to connect to card: {:?}", e),
                        }
                    }
                } else {
                    // Card removed
                    card_present = false;
                    last_uid.clear();
                }
            }
        }
    });

    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Tauri v2: get the main window
            let window = app
                .webview_windows()
                .get("main")
                .cloned()
                .expect("failed to get main window");

            start_nfc_listener(window)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri app");
}
