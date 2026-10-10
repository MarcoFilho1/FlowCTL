//! What the overlay reads of a Snapshot (mod/graph/types.ts); the page reads
//! the rest. As apps/overlay/Sources/FlowCTLCore/Snapshot.swift.

use serde_json::{Map, Value};

pub const SCHEMA: i64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Working,
    WaitingYou,
    Idle,
    Ended,
}

impl SessionState {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "working" => Some(Self::Working),
            "waiting_you" => Some(Self::WaitingYou),
            "idle" => Some(Self::Idle),
            "ended" => Some(Self::Ended),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Working => "working",
            Self::WaitingYou => "waiting_you",
            Self::Idle => "idle",
            Self::Ended => "ended",
        }
    }

    /// A session the person may want to watch: the agent works or waits on them.
    pub fn is_active(self) -> bool {
        matches!(self, Self::Working | Self::WaitingYou)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Info {
    pub session_id: String,
    pub seq: i64,
    pub state: SessionState,
    /// Milliseconds since 1970, as the mod writes it.
    pub updated_at: f64,
    pub node_count: usize,
    /// The Claude Code process of the session (`terminal.pid`).
    pub pid: Option<u32>,
}

/// Reads the fields the overlay needs and checks the shape the viewer
/// expects; the body itself goes to the page untouched.
pub fn parse(data: &[u8]) -> Result<Info, String> {
    let value: Value = serde_json::from_slice(data).map_err(|_| "not a JSON object".to_string())?;
    let object = value.as_object().ok_or("not a JSON object")?;
    if object.get("schema").and_then(Value::as_f64) != Some(SCHEMA as f64) {
        return Err("wrong schema".into());
    }
    let session_id = object.get("sessionId").and_then(Value::as_str).filter(|id| !id.is_empty()).ok_or("missing sessionId")?;
    let seq = object.get("seq").and_then(Value::as_f64).filter(|seq| seq.fract() == 0.0).ok_or("missing seq")?;
    let state = object.get("sessionState").and_then(Value::as_str).and_then(SessionState::parse).ok_or("missing sessionState")?;
    let nodes = object.get("nodes").and_then(Value::as_array).ok_or("missing nodes")?;
    if !object.get("layout").is_some_and(Value::is_object) {
        return Err("missing layout".into());
    }
    let updated_at = object.get("updatedAt").and_then(Value::as_f64).unwrap_or(0.0);
    let pid = object
        .get("terminal")
        .and_then(|terminal| terminal.get("pid"))
        .and_then(Value::as_f64)
        .filter(|pid| *pid > 0.0 && *pid <= u32::MAX as f64)
        .map(|pid| pid as u32);
    Ok(Info { session_id: session_id.to_string(), seq: seq as i64, state, updated_at, node_count: nodes.len(), pid })
}

/// The snapshot with its sessionState and seq replaced. The overlay sends the
/// viewer each session's effective state and a seq of its own that always
/// rises, so the viewer takes every update even when the mod's seq does not.
pub fn restamped(data: &[u8], state: SessionState, seq: i64) -> Vec<u8> {
    let Ok(Value::Object(mut object)) = serde_json::from_slice::<Value>(data) else {
        return data.to_vec();
    };
    object.insert("sessionState".into(), Value::String(state.as_str().into()));
    object.insert("seq".into(), Value::from(seq));
    serde_json::to_vec(&Value::Object(object)).unwrap_or_else(|_| data.to_vec())
}

/// The `terminal` object of a snapshot, for bringing its window forward.
pub fn terminal(data: &[u8]) -> Map<String, Value> {
    serde_json::from_slice::<Value>(data)
        .ok()
        .and_then(|value| value.get("terminal").and_then(Value::as_object).cloned())
        .unwrap_or_default()
}

#[cfg(test)]
pub fn sample(id: &str, seq: i64, state: &str, pid: Option<u32>) -> Vec<u8> {
    let terminal = pid.map(|pid| serde_json::json!({ "pid": pid })).unwrap_or(serde_json::json!({}));
    serde_json::to_vec(&serde_json::json!({
        "schema": 1, "seq": seq, "sessionId": id, "sessionState": state,
        "updatedAt": 1000, "nodes": [{"id": "turn:1"}], "layout": {}, "terminal": terminal
    }))
    .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_the_overlay_needs() {
        let info = parse(&sample("s1", 7, "waiting_you", Some(42))).unwrap();
        assert_eq!(
            info,
            Info { session_id: "s1".into(), seq: 7, state: SessionState::WaitingYou, updated_at: 1000.0, node_count: 1, pid: Some(42) }
        );
    }

    #[test]
    fn refuses_what_the_viewer_could_not_draw() {
        assert_eq!(parse(b"[]"), Err("not a JSON object".into()));
        assert_eq!(parse(br#"{"schema":2}"#), Err("wrong schema".into()));
        assert_eq!(parse(br#"{"schema":1,"sessionId":"","seq":1}"#), Err("missing sessionId".into()));
        assert_eq!(parse(br#"{"schema":1,"sessionId":"a","seq":1.5}"#), Err("missing seq".into()));
        assert_eq!(parse(br#"{"schema":1,"sessionId":"a","seq":1,"sessionState":"busy"}"#), Err("missing sessionState".into()));
        assert_eq!(parse(br#"{"schema":1,"sessionId":"a","seq":1,"sessionState":"idle","nodes":[]}"#), Err("missing layout".into()));
        let no_pid = parse(br#"{"schema":1,"sessionId":"a","seq":1,"sessionState":"idle","nodes":[],"layout":{},"terminal":{"pid":0}}"#);
        assert_eq!(no_pid.unwrap().pid, None);
    }

    #[test]
    fn restamping_replaces_state_and_seq_only() {
        let out = restamped(&sample("s1", 7, "working", None), SessionState::Ended, 3);
        let value: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(value["sessionState"], "ended");
        assert_eq!(value["seq"], 3);
        assert_eq!(value["sessionId"], "s1");
        assert_eq!(restamped(b"nope", SessionState::Idle, 1), b"nope");
    }
}
