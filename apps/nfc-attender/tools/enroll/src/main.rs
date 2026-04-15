use pcsc::{Context, Disposition, Protocols, ReaderState, ShareMode, State};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::io::{self, Write};
use std::time::Duration;

const PB_URL: &str = "https://learnlife.pockethost.io";

// ── NFC helpers (same pattern as src-tauri/src/main.rs) ──────────────

fn get_uid(card: &pcsc::Card) -> Option<String> {
    let apdu_get_uid: [u8; 5] = [0xFF, 0xCA, 0x00, 0x00, 0x00];
    let mut buf: [u8; 40] = [0; 40];
    match card.transmit(&apdu_get_uid, &mut buf) {
        Ok(response) if response.len() > 2 => Some(hex::encode(&response[..response.len() - 2])),
        _ => None,
    }
}

fn wait_for_card() -> Result<String, String> {
    let ctx = Context::establish(pcsc::Scope::User)
        .map_err(|e| format!("Failed to establish PC/SC context: {e}"))?;

    let mut buf = [0u8; 2048];
    let reader = ctx
        .list_readers(&mut buf)
        .map_err(|e| format!("Failed to list readers: {e}"))?
        .next()
        .ok_or_else(|| "No NFC readers found. Is a reader plugged in?".to_string())?
        .to_owned();

    println!("Using reader: {}", reader.to_string_lossy());
    println!();

    let mut states = [ReaderState::new(&*reader, State::UNAWARE)];

    // Wait for a card to appear
    loop {
        if let Err(e) = ctx.get_status_change(Some(Duration::from_millis(500)), &mut states) {
            // Timeout is normal, keep waiting
            if format!("{e}").contains("Timeout") {
                continue;
            }
            return Err(format!("Status change error: {e}"));
        }

        let state = states[0].event_state();
        if state.contains(State::PRESENT) {
            let card = ctx
                .connect(&reader, ShareMode::Shared, Protocols::ANY)
                .map_err(|e| format!("Failed to connect to card: {e}"))?;

            let uid = get_uid(&card).ok_or_else(|| "Failed to read UID from card".to_string())?;
            let _ = card.disconnect(Disposition::LeaveCard);
            return Ok(uid);
        }
    }
}

// ── PocketBase API ───────────────────────────────────────────────────

#[derive(Serialize)]
struct CreateLearnerBody {
    name: String,
    program: String,
    #[serde(rename = "NFC_ID")]
    nfc_id: String,
}

#[derive(Deserialize, Debug)]
struct PbAuthResponse {
    token: String,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
struct PbLearner {
    id: String,
    name: String,
    #[serde(rename = "NFC_ID")]
    nfc_id: Option<String>,
}

#[derive(Deserialize, Debug)]
struct PbListResponse {
    items: Vec<PbLearner>,
    #[serde(rename = "totalItems")]
    total_items: u32,
}

async fn pb_auth(client: &Client, email: &str, password: &str) -> Result<String, String> {
    let url = format!(
        "{PB_URL}/api/collections/_superusers/auth-with-password"
    );
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "identity": email,
            "password": password,
        }))
        .send()
        .await
        .map_err(|e| format!("Auth request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Auth failed ({status}): {body}"));
    }

    let auth: PbAuthResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse auth response: {e}"))?;
    Ok(auth.token)
}

async fn check_existing_learner(
    client: &Client,
    token: &str,
    uid: &str,
) -> Result<Option<PbLearner>, String> {
    let url = format!(
        "{PB_URL}/api/collections/learners/records?filter=NFC_ID='{uid}'&perPage=1"
    );
    let resp = client
        .get(&url)
        .header("Authorization", token)
        .send()
        .await
        .map_err(|e| format!("Lookup request failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let list: PbListResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse lookup response: {e}"))?;

    if list.total_items > 0 {
        Ok(list.items.into_iter().next())
    } else {
        Ok(None)
    }
}

async fn create_learner(
    client: &Client,
    token: &str,
    body: &CreateLearnerBody,
) -> Result<PbLearner, String> {
    let url = format!("{PB_URL}/api/collections/learners/records");
    let resp = client
        .post(&url)
        .header("Authorization", token)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Create request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Create failed ({status}): {body}"));
    }

    resp.json::<PbLearner>()
        .await
        .map_err(|e| format!("Failed to parse create response: {e}"))
}

// ── CLI helpers ──────────────────────────────────────────────────────

fn prompt(label: &str) -> String {
    print!("{label}");
    io::stdout().flush().unwrap();
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    input.trim().to_string()
}

fn prompt_program() -> String {
    println!("  1) Explorer");
    println!("  2) Creator");
    println!("  3) Changemaker");
    let choice = prompt("  Choose [1/2/3]: ");
    match choice.as_str() {
        "1" => "exp".to_string(),
        "2" => "cre".to_string(),
        "3" => "chmk".to_string(),
        _ => {
            println!("  Invalid choice, defaulting to Explorer");
            "exp".to_string()
        }
    }
}

// ── Main ─────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    println!("╔══════════════════════════════════╗");
    println!("║     NFC Card Enrollment Tool     ║");
    println!("╚══════════════════════════════════╝");
    println!();

    // Auth
    let email = std::env::var("PB_ADMIN_EMAIL").unwrap_or_else(|_| prompt("PocketBase admin email: "));
    let password =
        std::env::var("PB_ADMIN_PASSWORD").unwrap_or_else(|_| prompt("PocketBase admin password: "));

    let client = Client::new();
    let token = match pb_auth(&client, &email, &password).await {
        Ok(t) => {
            println!("Authenticated successfully.");
            println!();
            t
        }
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    };

    // Enrollment loop
    loop {
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("Place an NFC card on the reader...");

        let uid = match wait_for_card() {
            Ok(uid) => uid,
            Err(e) => {
                eprintln!("Error: {e}");
                continue;
            }
        };

        println!("Card UID: {uid}");

        // Check if already enrolled
        match check_existing_learner(&client, &token, &uid).await {
            Ok(Some(learner)) => {
                println!(
                    "This card is already assigned to: {} (id: {})",
                    learner.name, learner.id
                );
                let answer = prompt("Re-assign this card to a new learner? [y/N]: ");
                if answer.to_lowercase() != "y" {
                    println!("Skipped.");
                    println!();
                    continue;
                }
            }
            Ok(None) => {
                println!("New card — not yet assigned.");
            }
            Err(e) => {
                eprintln!("Warning: Could not check existing learner: {e}");
            }
        }

        // Collect learner info
        println!();
        let name = prompt("Learner name: ");
        if name.is_empty() {
            println!("Name cannot be empty, skipping.");
            continue;
        }
        println!("Program:");
        let program = prompt_program();

        // Confirm
        println!();
        println!("  Name:    {name}");
        println!("  Program: {program}");
        println!("  NFC UID: {uid}");
        let confirm = prompt("Create this learner? [Y/n]: ");
        if confirm.to_lowercase() == "n" {
            println!("Cancelled.");
            println!();
            continue;
        }

        // Create in PocketBase
        let body = CreateLearnerBody {
            name,
            program,
            nfc_id: uid,
        };

        match create_learner(&client, &token, &body).await {
            Ok(learner) => {
                println!("Created learner: {} (id: {})", learner.name, learner.id);
            }
            Err(e) => {
                eprintln!("Error creating learner: {e}");
            }
        }

        println!();
        let again = prompt("Enroll another card? [Y/n]: ");
        if again.to_lowercase() == "n" {
            break;
        }
    }

    println!("Done!");
}
