//! The snapshot files the mod leaves in ~/.flowctl/sessions: which to show
//! when the overlay opens, and which to delete (the mod cannot delete files).
//! As apps/overlay/Sources/FlowCTLCore/SessionFiles.swift.

use super::snapshot::{self, SessionState};

pub const MAX_AGE: f64 = 24.0 * 60.0 * 60.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub name: String,
    pub data: Vec<u8>,
    /// Seconds since 1970.
    pub modified: f64,
}

#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    /// Sessions to show, oldest update first.
    pub show: Vec<Entry>,
    /// File names to delete.
    pub delete: Vec<String>,
}

/// Ended sessions, sessions whose pid is gone, and files older than a day
/// go; the rest are shown, oldest update first. A file that does not parse
/// is left alone while fresh: the mod may be writing it right now.
pub fn plan(entries: Vec<Entry>, now: f64, is_alive: impl Fn(u32) -> bool) -> Plan {
    let mut plan = Plan::default();
    let mut shown = Vec::new();
    for entry in entries.into_iter().filter(|e| e.name.ends_with(".json")) {
        let is_old = now - entry.modified > MAX_AGE;
        match snapshot::parse(&entry.data) {
            Err(_) => {
                if is_old {
                    plan.delete.push(entry.name);
                }
            }
            Ok(info) => {
                let gone = info.pid.is_some_and(|pid| !is_alive(pid));
                if is_old || info.state == SessionState::Ended || gone {
                    plan.delete.push(entry.name);
                } else {
                    shown.push((info.updated_at, entry));
                }
            }
        }
    }
    shown.sort_by(|a, b| a.0.total_cmp(&b.0));
    plan.show = shown.into_iter().map(|(_, entry)| entry).collect();
    plan.delete.sort();
    plan
}

/// Reads a directory's regular files, by name; a missing one has none.
pub fn read(directory: &std::path::Path) -> Vec<Entry> {
    let Ok(listing) = std::fs::read_dir(directory) else { return Vec::new() };
    let mut entries: Vec<Entry> = listing
        .filter_map(Result::ok)
        .filter_map(|item| {
            let meta = item.metadata().ok().filter(|m| m.is_file())?;
            let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs_f64();
            let data = std::fs::read(item.path()).ok()?;
            Some(Entry { name: item.file_name().to_string_lossy().into_owned(), data, modified })
        })
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::snapshot::sample;

    fn entry(name: &str, data: Vec<u8>, modified: f64) -> Entry {
        Entry { name: name.into(), data, modified }
    }

    #[test]
    fn keeps_live_sessions_and_deletes_the_rest() {
        let now = 2.0 * MAX_AGE;
        let fresh = now - 60.0;
        let mut later = sample("b", 1, "working", Some(1));
        later = String::from_utf8(later).unwrap().replace("\"updatedAt\":1000", "\"updatedAt\":2000").into_bytes();
        let plan = plan(
            vec![
                entry("b.json", later, fresh),
                entry("a.json", sample("a", 1, "idle", None), fresh),
                entry("ended.json", sample("e", 1, "ended", None), fresh),
                entry("dead.json", sample("d", 1, "working", Some(2)), fresh),
                entry("old.json", sample("o", 1, "idle", None), now - MAX_AGE - 1.0),
                entry("writing.json", b"{\"sch".to_vec(), fresh),
                entry("junk.json", b"x".to_vec(), 0.0),
                entry("notes.txt", b"x".to_vec(), 0.0),
            ],
            now,
            |pid| pid == 1,
        );
        assert_eq!(plan.show.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["a.json", "b.json"]);
        assert_eq!(plan.delete, vec!["dead.json", "ended.json", "junk.json", "old.json"]);
    }
}
