mod auth;

use std::fs;
use std::fs::File;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

// Store the file paths passed via command line
struct OpenedFiles(Mutex<Vec<String>>);

// Store locked file handles to prevent other apps from writing
struct LockedFiles(Mutex<HashMap<String, File>>);

// Cache PDF file bytes to avoid re-reading from disk on every render call
struct PdfBytesCache(Mutex<HashMap<String, Vec<u8>>>);

// Cache parsed DocumentHandle objects so the font registry inside each
// handle survives across page renders. The handle holds a Mutex<FontRegistry>
// internally — extracting glyph outlines for a font (the dominant cost on
// text-heavy pages) only runs the first time that font is encountered in
// the document. Without this cache every Tauri command would create a
// fresh DocumentHandle and re-extract every glyph from scratch.
struct DocHandleCache(Mutex<HashMap<String, Arc<open_pdf_render::DocumentHandle>>>);

/// Cache for already-rendered thumbnails. Keyed by (path, page, max_width, rotation).
/// Hits return instantly without touching the renderer or JPEG encoder, which
/// makes scrolling back to previously-rendered pages essentially free.
struct ThumbnailCache(Mutex<HashMap<(String, u32, u32, i32), String>>);

#[tauri::command]
fn get_opened_file(state: tauri::State<OpenedFiles>) -> Vec<String> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn get_session_file_path() -> String {
    if let Some(data_dir) = dirs::data_local_dir() {
        let app_dir = data_dir.join("OpenPDFStudio");
        if !app_dir.exists() {
            let _ = fs::create_dir_all(&app_dir);
        }
        app_dir.join("session.json").to_string_lossy().to_string()
    } else {
        "session.json".to_string()
    }
}

#[tauri::command]
fn save_session(data: String) -> Result<bool, String> {
    let path = get_session_file_path();
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn load_session() -> Option<String> {
    let path = get_session_file_path();
    fs::read_to_string(&path).ok()
}

fn get_preferences_file_path() -> String {
    if let Some(data_dir) = dirs::data_local_dir() {
        let app_dir = data_dir.join("OpenPDFStudio");
        if !app_dir.exists() {
            let _ = fs::create_dir_all(&app_dir);
        }
        app_dir.join("preferences.json").to_string_lossy().to_string()
    } else {
        "preferences.json".to_string()
    }
}

#[tauri::command]
fn save_preferences(data: String) -> Result<bool, String> {
    let path = get_preferences_file_path();
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn load_preferences() -> Option<String> {
    let path = get_preferences_file_path();
    fs::read_to_string(&path).ok()
}

#[tauri::command]
fn get_username() -> String {
    whoami::username()
}

// Fallback commands for when plugins aren't available via global API

#[tauri::command]
fn read_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, data: String) -> Result<bool, String> {
    let bytes = BASE64.decode(&data).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

/// Check if this app is the default handler for .pdf files on Windows.
/// Returns true if our exe is the registered handler, false otherwise.
/// Uses spawn_blocking so the subprocess calls never block the main thread.
#[tauri::command]
async fn is_default_pdf_app() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            // Get our own executable path
            let our_exe = match std::env::current_exe() {
                Ok(p) => p.to_string_lossy().to_lowercase(),
                Err(_) => return false,
            };

            // Query the UserChoice ProgId for .pdf
            let output = match std::process::Command::new("reg")
                .args(&["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice", "/v", "ProgId"])
                .output()
            {
                Ok(o) => o,
                Err(_) => return false,
            };
            let stdout = String::from_utf8_lossy(&output.stdout);

            // Extract ProgId value from reg query output
            let prog_id = stdout.lines()
                .find(|line| line.contains("ProgId"))
                .and_then(|line| line.split_whitespace().last())
                .unwrap_or("");

            if prog_id.is_empty() {
                return false;
            }

            // Check if the ProgId directly matches our app name
            if prog_id.to_lowercase().contains("openpdfstudio") {
                return true;
            }

            // Look up the shell\open\command for this ProgId in HKCR
            let key_path = format!(r"HKCR\{}\shell\open\command", prog_id);
            let output2 = match std::process::Command::new("reg")
                .args(&["query", &key_path, "/ve"])
                .output()
            {
                Ok(o) => o,
                Err(_) => return false,
            };
            let stdout2 = String::from_utf8_lossy(&output2.stdout).to_lowercase();

            stdout2.contains("openpdfstudio") || stdout2.contains(&our_exe.replace('\\', "\\\\"))
        }

        #[cfg(target_os = "linux")]
        {
            // Use xdg-mime: works on any XDG-compliant desktop (GNOME, KDE,
            // Cinnamon, MATE, XFCE) across distros (Mint, Ubuntu, Fedora, Arch).
            let output = match std::process::Command::new("xdg-mime")
                .args(&["query", "default", "application/pdf"])
                .output()
            {
                Ok(o) => o,
                Err(_) => return false,
            };
            let default_desktop = String::from_utf8_lossy(&output.stdout).trim().to_string();
            default_desktop == "Open PDF Studio.desktop" || default_desktop == "open-pdf-studio.desktop"
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            false
        }
    }).await.unwrap_or(false)
}

/// Make this app the default handler for .pdf files.
/// On Windows, opens the system default-apps settings page. On Linux, sets the
/// xdg-mime default directly (no system UI for this exists on most desktops).
#[tauri::command]
fn open_default_apps_settings() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        // Open the "Choose default apps by file type" settings page
        std::process::Command::new("cmd")
            .args(&["/c", "start", "ms-settings:defaultapps"])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-mime is the desktop-environment agnostic way to set the default
        // handler. The .desktop filename must match what tauri-bundler wrote in
        // /usr/share/applications (the bundle uses the app's productName).
        let status = std::process::Command::new("xdg-mime")
            .args(&["default", "Open PDF Studio.desktop", "application/pdf"])
            .status()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "xdg-mime not found. Install xdg-utils (e.g. `sudo apt install xdg-utils`) and try again.".to_string()
                } else {
                    format!("Failed to run xdg-mime: {}", e)
                }
            })?;
        if !status.success() {
            return Err(format!(
                "xdg-mime exited with status {}. The .desktop file may not be registered — install Open PDF Studio via the bundled .deb/.AppImage so /usr/share/applications/Open PDF Studio.desktop exists.",
                status
            ));
        }
        Ok(true)
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(false)
    }
}

/// Lock a file to prevent other applications from writing to it.
/// Opens the file with shared read access only (no write sharing on Windows).
#[tauri::command]
fn lock_file(path: String, state: tauri::State<LockedFiles>) -> Result<bool, String> {
    let mut locks = state.0.lock().map_err(|e| e.to_string())?;

    // Already locked by us
    if locks.contains_key(&path) {
        return Ok(true);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ = 0x00000001 — allow others to read, but not write or delete
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(0) // no special flags
            .share_mode(0x00000001) // FILE_SHARE_READ only
            .open(&path)
            .map_err(|e| format!("Failed to lock file: {}", e))?;
        locks.insert(path, file);
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Unix, use advisory file locking (flock)
        let file = fs::OpenOptions::new()
            .read(true)
            .open(&path)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        // Advisory lock — other well-behaved apps will respect this
        // Note: this is best-effort on non-Windows platforms
        locks.insert(path, file);
    }

    Ok(true)
}

/// Unlock a previously locked file, allowing other apps to write to it.
#[tauri::command]
fn unlock_file(path: String, state: tauri::State<LockedFiles>) -> Result<bool, String> {
    let mut locks = state.0.lock().map_err(|e| e.to_string())?;
    // Removing the entry drops the File handle, releasing the lock
    locks.remove(&path);
    Ok(true)
}

/// Enumerate installed printers via PowerShell CIM.
/// Returns a JSON array of printer objects.
#[tauri::command]
fn get_printers() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile", "-NonInteractive", "-Command",
                "Get-CimInstance -ClassName Win32_Printer | Select-Object Name, DriverName, Default, PrinterStatus | ConvertTo-Json -Compress"
            ])
            .output()
            .map_err(|e| format!("Failed to enumerate printers: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("PowerShell error: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        // PowerShell returns a single object (not array) when there's only one printer
        let trimmed = stdout.trim();
        if trimmed.starts_with('{') {
            Ok(format!("[{}]", trimmed))
        } else {
            Ok(trimmed.to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok("[]".to_string())
    }
}

/// Print a PDF file to a specific printer using ShellExecuteW.
/// Uses separate arguments to avoid PowerShell command injection.
#[tauri::command]
fn print_pdf(path: String, printer: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        // Validate path exists and is a file
        let p = std::path::Path::new(&path);
        if !p.is_file() {
            return Err("File does not exist".to_string());
        }

        // Use ShellExecuteW directly with the "printto" verb — no shell interpolation
        use std::os::windows::ffi::OsStrExt;
        use std::ffi::OsStr;

        fn to_wide(s: &str) -> Vec<u16> {
            OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
        }

        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut std::ffi::c_void,
                operation: *const u16,
                file: *const u16,
                parameters: *const u16,
                directory: *const u16,
                show_cmd: i32,
            ) -> isize;
        }

        let verb = to_wide("printto");
        let file = to_wide(&path);
        let params = to_wide(&format!("\"{}\"", printer));
        const SW_HIDE: i32 = 0;

        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file.as_ptr(),
                params.as_ptr(),
                std::ptr::null(),
                SW_HIDE,
            )
        };

        if result as usize > 32 {
            Ok(true)
        } else {
            Err(format!("ShellExecute failed with code {}", result))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Printing is only supported on Windows".to_string())
    }
}

/// Open the document properties (printing preferences) dialog for a given printer name.
#[tauri::command]
fn open_printer_properties(window: tauri::WebviewWindow, printer: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Graphics::Printing::{
            OpenPrinterW, ClosePrinter, DocumentPropertiesW,
        };

        // Get the HWND from the Tauri window so the dialog is modal
        let hwnd = window.hwnd().map_err(|e| format!("Failed to get window handle: {}", e))?;
        let hwnd_raw = hwnd.0 as windows_sys::Win32::Foundation::HWND;

        // Convert printer name to wide string
        let wide_name: Vec<u16> = printer.encode_utf16().chain(std::iter::once(0)).collect();

        let mut h_printer: windows_sys::Win32::Foundation::HANDLE = std::ptr::null_mut();
        let opened = unsafe {
            OpenPrinterW(wide_name.as_ptr(), &mut h_printer, std::ptr::null_mut())
        };

        if opened == 0 || h_printer.is_null() {
            return Err(format!("Failed to open printer '{}'", printer));
        }

        // DocumentPropertiesW is blocking — run on a thread to avoid freezing the event loop.
        // DM_IN_PROMPT (0x4) tells it to show the dialog to the user.
        let hwnd_usize = hwnd_raw as usize;
        let printer_usize = h_printer as usize;
        let device_name = wide_name;

        std::thread::spawn(move || {
            unsafe {
                const DM_IN_PROMPT: u32 = 0x4;
                DocumentPropertiesW(
                    hwnd_usize as _,
                    printer_usize as _,
                    device_name.as_ptr() as _,
                    std::ptr::null_mut(),   // pDevModeOutput — not capturing changes
                    std::ptr::null_mut(),   // pDevModeInput
                    DM_IN_PROMPT,
                );
                ClosePrinter(printer_usize as _);
            }
        });

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        Err("Printer properties dialog is only supported on Windows".to_string())
    }
}

/// Get the system temp directory path.
#[tauri::command]
fn get_temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().to_string()
}

/// Write binary data to a temp file and return the path.
/// This bypasses the FS plugin scope restrictions.
#[tauri::command]
fn write_temp_pdf(data: Vec<u8>) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = temp_dir.join(format!("openstudio_print_{}.pdf", timestamp));
    fs::write(&path, &data).map_err(|e| format!("Failed to write temp file: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// Delete a file at the given path.
#[tauri::command]
fn delete_file(path: String) -> Result<bool, String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))?;
    Ok(true)
}

/// Rename (move) a file from old_path to new_path.
#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<bool, String> {
    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename file: {}", e))?;
    Ok(true)
}

/// Run a PowerShell script with UAC elevation by writing it to a temp .ps1
/// file, executing it as admin, and capturing errors via a log file.
#[cfg(target_os = "windows")]
fn run_elevated_ps_script(script: &str) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let script_path = temp_dir.join(format!("ops_printer_{}.ps1", timestamp));
    let log_path = temp_dir.join(format!("ops_printer_{}.log", timestamp));

    // Wrap the script: redirect all errors to a log file, write "OK" on success
    let wrapped = format!(
        r#"try {{
{}
'OK' | Out-File -FilePath '{}' -Encoding UTF8
}} catch {{
$_.Exception.Message | Out-File -FilePath '{}' -Encoding UTF8
exit 1
}}"#,
        script,
        log_path.to_string_lossy(),
        log_path.to_string_lossy()
    );

    fs::write(&script_path, &wrapped)
        .map_err(|e| format!("Failed to write temp script: {}", e))?;

    // Launch elevated: Start-Process -Verb RunAs -Wait on the .ps1 file
    // Build the -ArgumentList as a single quoted string with each param separated by commas.
    // The script path is passed as a properly escaped argument, not interpolated into a command string.
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let script_path_str = script_path.to_string_lossy().to_string();
    let arg_list = format!(
        "'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','{}'",
        script_path_str.replace('\'', "''")
    );
    let output = std::process::Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(format!(
            "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList {}",
            arg_list
        ))
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to launch elevated process: {}", e))?;

    // Read the log file written by the elevated process
    let log_content = fs::read_to_string(&log_path).unwrap_or_default();
    let log_trimmed = log_content.trim();

    // Cleanup temp files
    let _ = fs::remove_file(&script_path);
    let _ = fs::remove_file(&log_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("UAC elevation failed: {}", stderr));
    }

    if log_trimmed.is_empty() {
        return Err("Elevated script produced no output — user may have cancelled UAC".to_string());
    }

    // Check BOM-prefixed "OK" (UTF-8 BOM from Out-File)
    if log_trimmed == "OK" || log_trimmed.ends_with("OK") {
        Ok(())
    } else {
        Err(format!("Elevated script error: {}", log_trimmed))
    }
}

/// Install a virtual printer named "Open PDF Studio" using the built-in
/// "Microsoft Print to PDF" driver with the PORTPROMPT: port (shows a
/// Save As dialog with print preview, just like the stock PDF printer).
/// Requires one-time UAC admin elevation.
#[tauri::command]
fn install_virtual_printer() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"$ErrorActionPreference = 'Stop'
$printerName = 'Open PDF Studio'

# Remove existing printer if present (ignore errors)
try { Remove-Printer -Name $printerName -ErrorAction SilentlyContinue } catch {}

# Create the printer using the built-in PDF driver and PORTPROMPT: port
# PORTPROMPT: shows a Save As dialog with print preview
Add-Printer -Name $printerName -DriverName 'Microsoft Print to PDF' -PortName 'PORTPROMPT:'"#;

        run_elevated_ps_script(script)?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Virtual printer is only supported on Windows".to_string())
    }
}

/// Remove the "Open PDF Studio" virtual printer.
/// Requires UAC admin elevation.
#[tauri::command]
fn remove_virtual_printer() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"$ErrorActionPreference = 'Stop'
$printerName = 'Open PDF Studio'

Remove-Printer -Name $printerName

# Clean up any leftover local port from older installations
Get-PrinterPort | Where-Object { $_.Name -like '*OpenPDFStudio*print-capture*' } | Remove-PrinterPort"#;

        run_elevated_ps_script(script)?;
        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Virtual printer is only supported on Windows".to_string())
    }
}

/// Check whether the "Open PDF Studio" virtual printer is installed.
#[tauri::command]
fn is_virtual_printer_installed() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile", "-NonInteractive", "-Command",
                "Get-Printer -Name 'Open PDF Studio' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name"
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.trim() == "Open PDF Studio"
            }
            Err(_) => false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Download a PDF from a URL and save it to a temp file.
/// Returns the temp file path on success.
#[tauri::command]
async fn download_pdf_from_url(url: String) -> Result<String, String> {
    let response = reqwest::get(&url).await.map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("Failed to read response: {}", e))?;

    if bytes.is_empty() {
        return Err("Downloaded file is empty".to_string());
    }

    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    // Try to extract filename from URL
    let filename = url.split('/').last()
        .and_then(|s| s.split('?').next())
        .filter(|s| s.to_lowercase().ends_with(".pdf"))
        .unwrap_or("download.pdf");

    let path = temp_dir.join(format!("openstudio_url_{}_{}", timestamp, filename));
    fs::write(&path, &bytes).map_err(|e| format!("Failed to write temp file: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// List PDF files in a directory.
/// Returns a list of full file paths for .pdf files found.
#[tauri::command]
fn list_pdf_files(dir: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut pdf_files: Vec<String> = Vec::new();

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.to_string_lossy().to_lowercase() == "pdf" {
                        pdf_files.push(path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    pdf_files.sort();
    Ok(pdf_files)
}

#[tauri::command]
fn play_alert_sound() {
    #[cfg(target_os = "windows")]
    {
        use std::os::raw::c_uint;
        #[link(name = "user32")]
        extern "system" {
            fn MessageBeep(uType: c_uint) -> i32;
        }
        unsafe { MessageBeep(0x00000030); } // MB_ICONEXCLAMATION
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("afplay")
            .arg("/System/Library/Sounds/Funk.aiff")
            .spawn()
            .ok();
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("paplay")
            .arg("/usr/share/sounds/freedesktop/stereo/dialog-warning.oga")
            .spawn()
            .ok();
    }
}

// --- Plugin Management ---

fn get_plugins_dir() -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let plugins_dir = data_dir.join("OpenPDFStudio").join("plugins");
    if !plugins_dir.exists() {
        let _ = fs::create_dir_all(&plugins_dir);
    }
    plugins_dir
}

#[tauri::command]
fn list_plugins() -> Result<Vec<serde_json::Value>, String> {
    let plugins_dir = get_plugins_dir();
    let mut plugins = Vec::new();

    if let Ok(entries) = fs::read_dir(&plugins_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("plugin.json");
                if manifest_path.exists() {
                    if let Ok(content) = fs::read_to_string(&manifest_path) {
                        if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                            plugins.push(manifest);
                        }
                    }
                }
            }
        }
    }

    Ok(plugins)
}

#[tauri::command]
fn install_plugin(path: String) -> Result<serde_json::Value, String> {
    let src_path = std::path::Path::new(&path);
    if !src_path.exists() {
        return Err("File not found".to_string());
    }

    let file = fs::File::open(&src_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid plugin archive: {}", e))?;

    // Read plugin.json from the archive to get the plugin id
    let manifest_content = {
        let mut manifest_file = archive.by_name("plugin.json")
            .map_err(|_| "Plugin archive must contain plugin.json".to_string())?;
        let mut content = String::new();
        std::io::Read::read_to_string(&mut manifest_file, &mut content)
            .map_err(|e| format!("Failed to read plugin.json: {}", e))?;
        content
    };

    let manifest: serde_json::Value = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("Invalid plugin.json: {}", e))?;

    let plugin_id = manifest.get("id")
        .and_then(|v| v.as_str())
        .ok_or("plugin.json must have an 'id' field")?;

    // Validate plugin id (prevent path traversal)
    if plugin_id.contains("..") || plugin_id.contains('/') || plugin_id.contains('\\') {
        return Err("Invalid plugin id".to_string());
    }

    let plugins_dir = get_plugins_dir();
    let plugin_dir = plugins_dir.join(plugin_id);

    // Remove existing installation
    if plugin_dir.exists() {
        let _ = fs::remove_dir_all(&plugin_dir);
    }
    fs::create_dir_all(&plugin_dir).map_err(|e| format!("Failed to create plugin dir: {}", e))?;

    // Re-open archive (consumed by by_name above)
    let file2 = fs::File::open(&src_path).map_err(|e| format!("Failed to reopen file: {}", e))?;
    let mut archive2 = zip::ZipArchive::new(file2).map_err(|e| format!("Invalid archive: {}", e))?;

    // Extract all files
    for i in 0..archive2.len() {
        let mut file = archive2.by_index(i).map_err(|e| format!("Archive error: {}", e))?;
        let outpath = plugin_dir.join(file.mangled_name());

        // Prevent path traversal
        if !outpath.starts_with(&plugin_dir) {
            continue;
        }

        if file.is_dir() {
            let _ = fs::create_dir_all(&outpath);
        } else {
            if let Some(parent) = outpath.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    Ok(manifest)
}

#[tauri::command]
fn uninstall_plugin(id: String) -> Result<bool, String> {
    // Validate id
    if id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid plugin id".to_string());
    }

    let plugins_dir = get_plugins_dir();
    let plugin_dir = plugins_dir.join(&id);

    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir).map_err(|e| format!("Failed to remove plugin: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
fn read_plugin_file(plugin_id: String, file_path: String) -> Result<String, String> {
    // Validate inputs
    if plugin_id.contains("..") || plugin_id.contains('/') || plugin_id.contains('\\') {
        return Err("Invalid plugin id".to_string());
    }
    if file_path.contains("..") {
        return Err("Invalid file path".to_string());
    }

    let plugins_dir = get_plugins_dir();
    let full_path = plugins_dir.join(&plugin_id).join(&file_path);

    // Ensure the resolved path is within the plugin directory
    if !full_path.starts_with(plugins_dir.join(&plugin_id)) {
        return Err("Path traversal detected".to_string());
    }

    fs::read_to_string(&full_path).map_err(|e| format!("Failed to read file: {}", e))
}

// ─── Allow FS access to a path (for testing / programmatic file opens) ────
#[tauri::command]
fn allow_fs_scope(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    app.fs_scope().allow_file(&path)
        .map_err(|e| format!("{}", e))?;
    // Also allow the directory for related files
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = app.fs_scope().allow_directory(parent, false);
    }
    Ok(true)
}

// ─── PDF rendering via open-pdf-render (pure Rust) ────────────────────────
use open_pdf_render::{DocumentHandle, PdfRenderer};

/// Get a cached `Arc<DocumentHandle>` for the given file, or load + cache one.
///
/// First checks the DocHandleCache. On miss, falls back to the bytes cache
/// (or disk), parses the PDF once, and stores the resulting Arc in the
/// handle cache for all future commands. The handle owns its own internal
/// font registry so subsequent extract_draw_commands calls reuse all glyph
/// outlines from previous pages.
fn get_or_load_doc(
    path: &str,
    bytes_cache: &PdfBytesCache,
    handle_cache: &DocHandleCache,
) -> Result<Arc<DocumentHandle>, String> {
    // Fast path — handle already cached
    {
        let cache_map = handle_cache.0.lock().map_err(|e| format!("Handle cache lock: {}", e))?;
        if let Some(handle) = cache_map.get(path) {
            return Ok(handle.clone());
        }
    }

    // Slow path — fetch bytes (from cache or disk), parse, insert
    let bytes = {
        let mut bm = bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?;
        if let Some(cached) = bm.get(path) {
            cached.clone()
        } else {
            let read = fs::read(path).map_err(|e| format!("Read: {}", e))?;
            bm.insert(path.to_string(), read.clone());
            read
        }
    };

    let renderer = PdfRenderer::new();
    let handle = renderer.load_document(&bytes).map_err(|e| format!("{}", e))?;
    let arc = Arc::new(handle);

    {
        let mut hm = handle_cache.0.lock().map_err(|e| format!("Handle cache lock: {}", e))?;
        // Double-check in case another thread inserted while we were parsing.
        if let Some(existing) = hm.get(path) {
            return Ok(existing.clone());
        }
        hm.insert(path.to_string(), arc.clone());
    }
    Ok(arc)
}

#[tauri::command]
fn render_pdf_page(
    path: String,
    page_index: u32,
    scale: f32,
    rotation: Option<i32>,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<String, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let extra_rot = rotation.unwrap_or(0);
    let page = doc.render_page(page_index as usize, scale, extra_rot).map_err(|e| format!("{}", e))?;

    // Write RGBA to temp file (Tauri IPC is too slow for 16-36MB binary data)
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("opdf_{}_{}.raw", page_index,
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()));

    let mut data = Vec::with_capacity(8 + page.rgba.len());
    data.extend_from_slice(&page.width.to_le_bytes());
    data.extend_from_slice(&page.height.to_le_bytes());
    data.extend_from_slice(&page.rgba);
    fs::write(&temp_path, &data).map_err(|e| format!("Write temp: {}", e))?;

    // Return path|width|height (tiny string, fast IPC)
    Ok(format!("{}|{}|{}", temp_path.to_string_lossy(), page.width, page.height))
}

/// Render a thumbnail for a PDF page. Returns a JSON string with {dataURL, width, height}.
/// Uses the Rust bitmap renderer at low resolution for maximum speed (~10-50ms per page).
#[tauri::command]
fn render_thumbnail(
    path: String,
    page_index: u32,
    max_width: u32,
    rotation: Option<i32>,
    skip_images: Option<bool>,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
    thumb_cache: tauri::State<ThumbnailCache>,
) -> Result<String, String> {
    let extra_rot = rotation.unwrap_or(0);
    let skip_img = skip_images.unwrap_or(false);

    // Cache hit: previously rendered (path, page, max_width, rotation) is
    // returned instantly. Thumbnails are deterministic given these inputs
    // (annotation overlay happens client-side), so caching is safe.
    let cache_key = (path.clone(), page_index, max_width, extra_rot);
    if let Ok(tc) = thumb_cache.0.lock() {
        if let Some(cached) = tc.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;

    // Get page dimensions to calculate thumbnail scale
    let (w_pt, h_pt) = doc.page_dimensions(page_index as usize)
        .map_err(|e| format!("{}", e))?;

    // Scale so the longest side fits within max_width pixels
    let scale = max_width as f32 / w_pt.max(h_pt);

    // Render at thumbnail scale. When skipImages is set, cap image decode
    // to ~2× the rendered thumbnail pixel area. This is far smaller than
    // the previous fixed 250k budget (≈500×500) for typical 200px thumbs,
    // so turbojpeg picks a much more aggressive 1/4 or 1/8 DCT scale and
    // image decode drops from seconds to milliseconds.
    let page = if skip_img {
        let thumb_w = (w_pt.max(h_pt) * scale).ceil() as u32;
        let thumb_h = (w_pt.min(h_pt) * scale).ceil() as u32;
        // 2× area gives a small quality margin for rotation/clipping;
        // floor at 10k px so very small thumbs still get a sane budget.
        let budget = (thumb_w.saturating_mul(thumb_h).saturating_mul(2)).max(10_000);
        doc.render_page_with_image_limit(page_index as usize, scale, extra_rot, budget)
    } else {
        doc.render_page(page_index as usize, scale, extra_rot)
    }.map_err(|e| format!("{}", e))?;

    // Convert RGBA to RGB (JPEG doesn't support alpha)
    let pixel_count = (page.width * page.height) as usize;
    let mut rgb = Vec::with_capacity(pixel_count * 3);
    for i in 0..pixel_count {
        rgb.push(page.rgba[i * 4]);
        rgb.push(page.rgba[i * 4 + 1]);
        rgb.push(page.rgba[i * 4 + 2]);
    }

    // Encode RGB to JPEG in Rust (fast, small result for IPC)
    let mut jpeg_data = Vec::new();
    {
        use image::codecs::jpeg::JpegEncoder;
        use image::ImageEncoder;
        let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_data, 60);
        encoder.write_image(
            &rgb, page.width, page.height,
            image::ExtendedColorType::Rgb8,
        ).map_err(|e| format!("JPEG encode: {}", e))?;
    }

    // Return as base64 data URL (small enough for IPC, typically 5-30KB per thumbnail)
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_data);
    let result = format!("{{\"dataURL\":\"data:image/jpeg;base64,{}\",\"width\":{},\"height\":{}}}", b64, page.width, page.height);

    // Populate cache for instant subsequent retrieval (e.g. user scrolls
    // back, switches tabs, or invalidateThumbnail re-requests the page).
    if let Ok(mut tc) = thumb_cache.0.lock() {
        tc.insert(cache_key, result.clone());
    }

    Ok(result)
}

#[tauri::command]
fn analyze_page_type(
    path: String,
    page_index: u32,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<String, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    match doc.analyze_page_type(page_index as usize).map_err(|e| format!("{}", e))? {
        open_pdf_render::PageType::Vector => Ok("vector".into()),
        open_pdf_render::PageType::Tile => Ok("tile".into()),
    }
}

#[tauri::command]
fn extract_draw_commands(
    path: String,
    page_index: u32,
    rotation: Option<i32>,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<Vec<u8>, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let extra_rot = rotation.unwrap_or(0);
    let cmds = doc.extract_draw_commands(page_index as usize, extra_rot).map_err(|e| format!("{}", e))?;
    Ok(cmds.into_bytes())
}

#[tauri::command]
fn extract_page_text(
    path: String,
    page_index: u32,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<String, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    doc.extract_text_positions(page_index as usize).map_err(|e| format!("{}", e))
}

/// Batch extract draw commands for multiple pages in parallel using rayon.
/// Returns one Vec<u8> per requested page in the same order. Used for
/// adjacent-page prefetch (warm pages 2..N in the background after page 1
/// is on screen so wheel-scrolling forward feels instant).
///
/// `rotations` is a parallel array of extra rotation values (one per page).
/// Pass an empty array to use 0 for all pages.
#[tauri::command]
fn extract_draw_commands_batch(
    path: String,
    page_indices: Vec<u32>,
    rotations: Option<Vec<i32>>,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<Vec<Vec<u8>>, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let rots = rotations.unwrap_or_default();
    let pairs: Vec<(usize, i32)> = page_indices.iter().enumerate().map(|(i, &p)| {
        (p as usize, rots.get(i).copied().unwrap_or(0))
    }).collect();
    let results = doc.extract_draw_commands_batch(&pairs);
    let mut out = Vec::with_capacity(results.len());
    for r in results {
        out.push(r.map(|b| b.into_bytes()).map_err(|e| format!("{}", e))?);
    }
    Ok(out)
}

/// Extract text spans for the text-selection layer of one page.
/// Replaces the second PDF parse PDF.js used to do for getTextContent —
/// the Rust interpreter walks the same content stream as draw command
/// extraction but only emits text spans, sharing the document-scoped font
/// cache so glyph parsing is amortized across pages.
#[tauri::command]
fn extract_text(
    path: String,
    page_index: u32,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<Vec<TextSpanDto>, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let spans = doc.extract_text_spans(page_index as usize).map_err(|e| format!("{}", e))?;
    Ok(spans.into_iter().map(TextSpanDto::from).collect())
}

/// Batch text-span extraction for multiple pages, parallelized via rayon.
#[tauri::command]
fn extract_text_batch(
    path: String,
    page_indices: Vec<u32>,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<Vec<Vec<TextSpanDto>>, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    let pages: Vec<usize> = page_indices.iter().map(|i| *i as usize).collect();
    let results = doc.extract_text_spans_batch(&pages);
    let mut out = Vec::with_capacity(results.len());
    for r in results {
        out.push(r.map(|spans| spans.into_iter().map(TextSpanDto::from).collect())
                  .map_err(|e| format!("{}", e))?);
    }
    Ok(out)
}

/// Serializable mirror of `open_pdf_render::TextSpan` for Tauri IPC.
/// Tauri's serde plumbing requires types in this crate (or with derive
/// access). The Rust crate's TextSpan can't derive Serialize without
/// pulling serde into open-pdf-render, so we mirror it here.
#[derive(serde::Serialize)]
struct TextSpanDto {
    text: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    font_size: f32,
}

impl From<open_pdf_render::TextSpan> for TextSpanDto {
    fn from(s: open_pdf_render::TextSpan) -> Self {
        TextSpanDto {
            text: s.text,
            x: s.x,
            y: s.y,
            width: s.width,
            height: s.height,
            font_size: s.font_size,
        }
    }
}

/// Invalidate the PDF bytes cache AND the parsed handle cache for a specific
/// file (call after save/modify so the next render sees the new content).
#[tauri::command]
fn invalidate_pdf_cache(
    path: String,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
    thumb_cache: tauri::State<ThumbnailCache>,
) -> Result<bool, String> {
    bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?.remove(&path);
    handle_cache.0.lock().map_err(|e| format!("Handle cache lock: {}", e))?.remove(&path);
    if let Ok(mut tc) = thumb_cache.0.lock() {
        tc.retain(|(p, _, _, _), _| p != &path);
    }
    Ok(true)
}

/// Clear the entire PDF bytes cache AND parsed handle cache (call on app
/// cleanup or memory pressure).
#[tauri::command]
fn clear_pdf_cache(
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
    thumb_cache: tauri::State<ThumbnailCache>,
) -> Result<bool, String> {
    bytes_cache.0.lock().map_err(|e| format!("Bytes cache lock: {}", e))?.clear();
    handle_cache.0.lock().map_err(|e| format!("Handle cache lock: {}", e))?.clear();
    if let Ok(mut tc) = thumb_cache.0.lock() { tc.clear(); }
    Ok(true)
}

#[tauri::command]
fn get_page_dimensions(
    path: String,
    bytes_cache: tauri::State<PdfBytesCache>,
    handle_cache: tauri::State<DocHandleCache>,
) -> Result<Vec<(f32, f32)>, String> {
    let doc = get_or_load_doc(&path, &bytes_cache, &handle_cache)?;
    // Parallelized via rayon inside open-pdf-render — much faster than the
    // old sequential loop on multi-page documents.
    doc.page_dimensions_all()
        .into_iter()
        .map(|r| r.map_err(|e| format!("{}", e)))
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    // Handle --version / --help before Tauri::Builder::default().run() so these
    // flags print and exit instead of hanging in the event loop. Running the
    // full builder also squats the single-instance DBus name, which blocks
    // subsequent normal launches until the name is released.
    for arg in args.iter().skip(1) {
        match arg.as_str() {
            "--version" | "-V" => {
                println!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "--help" | "-h" => {
                println!("Usage: {} [OPTIONS] [FILE...]", env!("CARGO_PKG_NAME"));
                println!();
                println!("Options:");
                println!("  -h, --help       Print this help and exit");
                println!("  -V, --version    Print version and exit");
                println!();
                println!("Files:");
                println!("  One or more .pdf files to open.");
                std::process::exit(0);
            }
            _ => {}
        }
    }

    // Collect any PDF file paths passed on the command line (for file associations)
    let opened_files: Vec<String> = args.iter()
        .skip(1)
        .filter(|arg| arg.to_lowercase().ends_with(".pdf") && !arg.starts_with('-'))
        .cloned()
        .collect();

    let mut builder = tauri::Builder::default()
        .manage(OpenedFiles(Mutex::new(opened_files)))
        .manage(LockedFiles(Mutex::new(HashMap::new())))
        .manage(PdfBytesCache(Mutex::new(HashMap::new())))
        .manage(DocHandleCache(Mutex::new(HashMap::new())))
        .manage(ThumbnailCache(Mutex::new(HashMap::new())))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    // Single-instance and updater plugins are desktop-only
    #[cfg(not(target_os = "android"))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app: &tauri::AppHandle, argv: Vec<String>, _cwd: String| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                let files: Vec<String> = argv.iter()
                    .filter(|arg: &&String| arg.to_lowercase().ends_with(".pdf") && !arg.starts_with('-'))
                    .cloned()
                    .collect();
                for path in &files {
                    let _ = app.fs_scope().allow_file(path);
                }
                if !files.is_empty() {
                    let _ = app.emit("open-files", &files);
                }
            }))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            // Grant FS plugin scope for command-line files (file association)
            for path in app.state::<OpenedFiles>().0.lock().unwrap().iter() {
                let _ = app.fs_scope().allow_file(path);
            }

            // Set the window icon (desktop only — not applicable on Android)
            #[cfg(not(target_os = "android"))]
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_opened_file,
            save_session,
            load_session,
            get_username,
            read_file,
            write_file,
            file_exists,
            open_url,
            is_dev_mode,
            lock_file,
            unlock_file,
            is_default_pdf_app,
            open_default_apps_settings,
            get_printers,
            print_pdf,
            open_printer_properties,
            get_temp_dir,
            write_temp_pdf,
            delete_file,
            rename_file,
            install_virtual_printer,
            remove_virtual_printer,
            is_virtual_printer_installed,
            download_pdf_from_url,
            list_pdf_files,
            save_preferences,
            load_preferences,
            play_alert_sound,
            list_plugins,
            install_plugin,
            uninstall_plugin,
            read_plugin_file,
            render_pdf_page,
            get_page_dimensions,
            invalidate_pdf_cache,
            clear_pdf_cache,
            analyze_page_type,
            extract_draw_commands,
            extract_draw_commands_batch,
            extract_text,
            extract_text_batch,
            extract_page_text,
            render_thumbnail,
            allow_fs_scope,
            auth::auth_is_configured,
            auth::auth_login,
            auth::auth_logout,
            auth::auth_current_user,
            auth::auth_get_access_token,
            auth::auth_userinfo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
