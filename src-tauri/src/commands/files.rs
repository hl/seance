use crate::state::AppState;
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

/// Result type for diff computation.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum DiffResult {
    #[serde(rename = "ok")]
    Ok {
        diff_text: String,
        changed_files: Vec<String>,
        fallback_used: bool,
    },
    #[serde(rename = "no_changes")]
    NoChanges,
    #[serde(rename = "not_git_repo")]
    NotGitRepo,
    #[serde(rename = "error")]
    Error { message: String },
}

/// List `.md` files in the session's working directory.
/// In git repos: uses `git ls-files` respecting .gitignore.
/// In non-git dirs: recursive walk with depth/count limits.
#[tauri::command]
pub async fn list_markdown_files(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
) -> Result<Vec<String>, String> {
    let (working_dir, project_path) = resolve_session_dirs(&state, session_id).await?;
    let effective_dir = if working_dir.is_empty() {
        &project_path
    } else {
        &working_dir
    };

    // Try git ls-files first.
    if is_git_repo(effective_dir) {
        let output = std::process::Command::new("git")
            .args([
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "--",
                "*.md",
            ])
            .current_dir(effective_dir)
            .output()
            .map_err(|e| format!("Failed to run git ls-files: {}", e))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut files: Vec<String> = stdout
                .lines()
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect();
            files.sort();
            return Ok(files);
        }
    }

    // Fallback: recursive walk for non-git directories.
    let mut files = Vec::new();
    walk_md_files(std::path::Path::new(effective_dir), effective_dir, &mut files, 0, 10);
    files.sort();
    // Cap at 500 files.
    files.truncate(500);
    Ok(files)
}

/// Compute the cumulative session diff since `base_commit`.
#[tauri::command]
pub async fn get_session_diff(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
) -> Result<DiffResult, String> {
    let (working_dir, project_path, base_commit) = {
        let sessions = state.sessions.read().await;
        let session = sessions
            .get(&session_id)
            .ok_or_else(|| format!("Session {} not found", session_id))?;
        let projects = state.projects.read().await;
        let project = projects
            .get(&session.project_id)
            .ok_or_else(|| format!("Project {} not found", session.project_id))?;
        (
            session.working_dir.clone(),
            project.path.clone(),
            session.base_commit.clone(),
        )
    };

    let effective_dir = if working_dir.is_empty() {
        &project_path
    } else {
        &working_dir
    };

    let base = match base_commit {
        Some(ref sha) => sha.as_str(),
        None => return Ok(DiffResult::NotGitRepo),
    };

    // Validate SHA format (belt-and-suspenders against injection).
    if base.len() != 40 || !base.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(DiffResult::Error {
            message: "Invalid base commit SHA".to_string(),
        });
    }

    // Run git diff <base_commit> (diffs base tree against working tree).
    let output = std::process::Command::new("git")
        .args(["diff", base])
        .current_dir(effective_dir)
        .output();

    let (diff_text, fallback_used) = match output {
        Ok(out) if out.status.success() => {
            (String::from_utf8_lossy(&out.stdout).to_string(), false)
        }
        _ => {
            // Fallback: git diff HEAD (uncommitted changes only).
            let fallback = std::process::Command::new("git")
                .args(["diff", "HEAD"])
                .current_dir(effective_dir)
                .output();
            match fallback {
                Ok(out) if out.status.success() => {
                    (String::from_utf8_lossy(&out.stdout).to_string(), true)
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    return Ok(DiffResult::Error {
                        message: format!("git diff failed: {}", stderr.trim()),
                    });
                }
                Err(e) => {
                    return Ok(DiffResult::Error {
                        message: format!("Failed to run git: {}", e),
                    });
                }
            }
        }
    };

    if diff_text.trim().is_empty() {
        return Ok(DiffResult::NoChanges);
    }

    // Extract changed file names from diff headers.
    let changed_files = parse_changed_files(&diff_text);

    Ok(DiffResult::Ok {
        diff_text,
        changed_files,
        fallback_used,
    })
}

/// Read a markdown file from the session's working directory.
/// Path traversal protection via canonicalization.
#[tauri::command]
pub async fn read_markdown_file(
    state: tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
    relative_path: String,
) -> Result<String, String> {
    let (working_dir, project_path) = resolve_session_dirs(&state, session_id).await?;
    let effective_dir = if working_dir.is_empty() {
        &project_path
    } else {
        &working_dir
    };

    let base = std::fs::canonicalize(effective_dir)
        .map_err(|e| format!("Cannot resolve working directory: {}", e))?;

    let target = base.join(&relative_path);
    let canonical_target = std::fs::canonicalize(&target)
        .map_err(|_| format!("File not found: {}", relative_path))?;

    // Path traversal protection.
    if !canonical_target.starts_with(&base) {
        return Err("Access denied: path is outside working directory".to_string());
    }

    std::fs::read_to_string(&canonical_target)
        .map_err(|e| format!("Failed to read file: {}", e))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn resolve_session_dirs(
    state: &tauri::State<'_, Arc<AppState>>,
    session_id: Uuid,
) -> Result<(String, String), String> {
    let sessions = state.sessions.read().await;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))?;
    let projects = state.projects.read().await;
    let project = projects
        .get(&session.project_id)
        .ok_or_else(|| format!("Project {} not found", session.project_id))?;
    Ok((session.working_dir.clone(), project.path.clone()))
}

fn is_git_repo(dir: &str) -> bool {
    std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn walk_md_files(
    dir: &std::path::Path,
    root: &str,
    files: &mut Vec<String>,
    depth: usize,
    max_depth: usize,
) {
    if depth > max_depth || files.len() >= 500 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // Skip hidden directories.
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with('.') {
                continue;
            }
        }
        if path.is_dir() {
            walk_md_files(&path, root, files, depth + 1, max_depth);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(root) {
                files.push(rel.to_string_lossy().to_string());
            }
        }
    }
}

fn parse_changed_files(diff_text: &str) -> Vec<String> {
    let mut files = Vec::new();
    for line in diff_text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git a/") {
            // Format: "diff --git a/path b/path"
            if let Some(space_b) = rest.find(" b/") {
                let file = &rest[space_b + 3..];
                if !files.contains(&file.to_string()) {
                    files.push(file.to_string());
                }
            }
        }
    }
    files
}
