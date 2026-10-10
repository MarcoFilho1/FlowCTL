//! The sessions the overlay shows, with the rules for when the panel shows
//! and hides itself. Pure: the clock is passed in, in seconds. As
//! apps/overlay/Sources/FlowCTLCore/SessionRegistry.swift.

use super::snapshot::{self, Info, SessionState};
use std::collections::HashMap;

/// How long an ended session's tab stays up.
pub const ENDED_TAB_LIFETIME: f64 = 30.0;
/// Without a pid, a session that is working or waiting but has not been
/// written for this long is presumed dead: it counts as idle.
pub const STALE_AFTER: f64 = 30.0 * 60.0;
/// No active session for longer than this is idle: the panel hides.
pub const IDLE_AFTER: f64 = 5.0 * 60.0;

#[derive(Debug, Clone)]
pub struct Session {
    pub info: Info,
    /// The snapshot as received, to send again after a page reload.
    pub body: Vec<u8>,
    pub last_seen: f64,
    pub ended_at: Option<f64>,
    /// The seq the viewer was last sent: the overlay's own, always rising.
    viewer_seq: i64,
    /// The state the viewer was last sent.
    shown_state: Option<SessionState>,
    /// A snapshot arrived that the viewer has not been sent yet.
    needs_push: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Not newer than what is shown for that session: dropped.
    Stale,
    Accepted {
        is_new_session: bool,
        started_waiting: bool,
    },
}

pub struct Registry {
    sessions: HashMap<String, Session>,
    /// Session ids in the order they first arrived.
    order: Vec<String>,
    last_active_at: f64,
    idle_after: f64,
    is_alive: Box<dyn Fn(u32) -> bool + Send>,
}

impl Registry {
    /// `now`: when the overlay opened; idleness is counted from there.
    pub fn new(now: f64, idle_after: f64, is_alive: Box<dyn Fn(u32) -> bool + Send>) -> Self {
        Self { sessions: HashMap::new(), order: Vec::new(), last_active_at: now, idle_after, is_alive }
    }

    pub fn session(&self, id: &str) -> Option<&Session> {
        self.sessions.get(id)
    }

    /// `now`: when the snapshot was seen (a file's modification time, for one
    /// read from disk at launch).
    pub fn accept(&mut self, info: Info, body: Vec<u8>, now: f64) -> Outcome {
        let previous = self.sessions.get(&info.session_id);
        if let Some(previous) = previous {
            if info.seq <= previous.info.seq {
                return Outcome::Stale;
            }
        }
        let was_active = previous.is_some_and(|p| p.info.state.is_active());
        let was_waiting = previous.is_some_and(|p| p.info.state == SessionState::WaitingYou);
        let is_new_session = previous.is_none();
        let ended_at = if info.state == SessionState::Ended { Some(previous.and_then(|p| p.ended_at).unwrap_or(now)) } else { None };
        let (viewer_seq, shown_state) = previous.map(|p| (p.viewer_seq, p.shown_state)).unwrap_or((0, None));

        let id = info.session_id.clone();
        let state = info.state;
        self.sessions.insert(id.clone(), Session { info, body, last_seen: now, ended_at, viewer_seq, shown_state, needs_push: true });
        if is_new_session {
            self.order.push(id);
        }
        // A session that was active until this snapshot counts as active until now.
        if state.is_active() || was_active {
            self.last_active_at = self.last_active_at.max(now);
        }
        Outcome::Accepted { is_new_session, started_waiting: state == SessionState::WaitingYou && !was_waiting }
    }

    /// Drops sessions that ended at least `ENDED_TAB_LIFETIME` ago; returns their ids.
    pub fn expire_ended(&mut self, now: f64) -> Vec<String> {
        let expired: Vec<String> = self
            .order
            .iter()
            .filter(|id| self.sessions.get(*id).and_then(|s| s.ended_at).is_some_and(|ended| now - ended >= ENDED_TAB_LIFETIME))
            .cloned()
            .collect();
        for id in &expired {
            self.sessions.remove(id);
        }
        self.order.retain(|id| !expired.contains(id));
        expired
    }

    /// The state a session counts as now: ended when its pid is gone, idle
    /// when it has no pid and has not been written for `STALE_AFTER`.
    pub fn effective_state(&self, session: &Session, now: f64) -> SessionState {
        if session.info.state == SessionState::Ended || session.ended_at.is_some() {
            return SessionState::Ended;
        }
        if let Some(pid) = session.info.pid {
            return if (self.is_alive)(pid) { session.info.state } else { SessionState::Ended };
        }
        if session.info.state.is_active() && now - session.last_seen > STALE_AFTER {
            return SessionState::Idle;
        }
        session.info.state
    }

    pub fn active_count(&self, now: f64) -> usize {
        self.sessions.values().filter(|s| self.effective_state(s, now).is_active()).count()
    }

    /// Whether a session that is alive is waiting on the person (the tray's yellow node).
    pub fn is_any_waiting(&self, now: f64) -> bool {
        self.sessions.values().any(|s| self.effective_state(s, now) == SessionState::WaitingYou)
    }

    /// Marks the sessions whose pid is gone as ended from now. Returns them.
    pub fn reconcile(&mut self, now: f64) -> Vec<String> {
        let gone: Vec<String> = self
            .order
            .iter()
            .filter(|id| {
                let s = &self.sessions[*id];
                s.ended_at.is_none() && s.info.state != SessionState::Ended && s.info.pid.is_some_and(|pid| !(self.is_alive)(pid))
            })
            .cloned()
            .collect();
        for id in &gone {
            if let Some(s) = self.sessions.get_mut(id) {
                s.ended_at = Some(now);
            }
        }
        gone
    }

    /// True once no session has been active for longer than the idle limit.
    pub fn is_idle(&mut self, now: f64) -> bool {
        if self.active_count(now) > 0 {
            self.last_active_at = now;
            return false;
        }
        now - self.last_active_at > self.idle_after
    }

    /// What the viewer must be sent now, in arrival order: each session whose
    /// snapshot is new to it, or whose effective state changed since it was
    /// last sent, stamped with that state and the next viewer seq.
    pub fn pending_pushes(&mut self, now: f64) -> Vec<Vec<u8>> {
        self.stamp_where(now, true)
    }

    /// Every session, stamped with its effective state, for a page that starts over.
    pub fn replay_bodies(&mut self, now: f64) -> Vec<Vec<u8>> {
        self.stamp_where(now, false)
    }

    fn stamp_where(&mut self, now: f64, only_changed: bool) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        for id in self.order.clone() {
            let state = self.effective_state(&self.sessions[&id], now);
            let session = self.sessions.get_mut(&id).expect("ordered ids exist");
            if only_changed && !session.needs_push && session.shown_state == Some(state) {
                continue;
            }
            session.viewer_seq += 1;
            session.shown_state = Some(state);
            session.needs_push = false;
            out.push(snapshot::restamped(&session.body, state, session.viewer_seq));
        }
        out
    }
}

/// Why the panel is hidden, which decides what may bring it back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HiddenBy {
    Nobody,
    /// The person closed it: only a new session, or one that starts waiting on them, brings it back.
    User,
    /// Nothing was working or waiting for five minutes: only work brings it back.
    Idle,
}

/// Whether a snapshot should bring the panel up: its session works or waits,
/// and the panel is not hidden in a way the snapshot does not lift.
pub fn should_show(outcome: Outcome, state: SessionState, enabled: bool, hidden_by: HiddenBy) -> bool {
    let Outcome::Accepted { is_new_session, started_waiting } = outcome else { return false };
    if !enabled || !state.is_active() {
        return false;
    }
    match hidden_by {
        HiddenBy::Nobody | HiddenBy::Idle => true,
        HiddenBy::User => is_new_session || started_waiting,
    }
}

/// Opening the app again shows the panel, except when it went away for idleness.
pub fn reopen_shows(hidden_by: HiddenBy) -> bool {
    hidden_by != HiddenBy::Idle
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::snapshot::{parse, sample};
    use serde_json::Value;
    use std::sync::{Arc, Mutex};

    fn registry(alive: Arc<Mutex<bool>>) -> Registry {
        Registry::new(0.0, IDLE_AFTER, Box::new(move |_| *alive.lock().unwrap()))
    }

    fn accept(r: &mut Registry, id: &str, seq: i64, state: &str, pid: Option<u32>, now: f64) -> Outcome {
        let body = sample(id, seq, state, pid);
        r.accept(parse(&body).unwrap(), body, now)
    }

    fn states(bodies: &[Vec<u8>]) -> Vec<(String, i64)> {
        bodies
            .iter()
            .map(|b| {
                let v: Value = serde_json::from_slice(b).unwrap();
                (v["sessionState"].as_str().unwrap().to_string(), v["seq"].as_i64().unwrap())
            })
            .collect()
    }

    #[test]
    fn stale_snapshots_are_dropped_and_waiting_is_noticed() {
        let mut r = registry(Arc::new(Mutex::new(true)));
        assert_eq!(accept(&mut r, "a", 5, "working", None, 1.0), Outcome::Accepted { is_new_session: true, started_waiting: false });
        assert_eq!(accept(&mut r, "a", 5, "working", None, 2.0), Outcome::Stale);
        assert_eq!(accept(&mut r, "a", 6, "waiting_you", None, 3.0), Outcome::Accepted { is_new_session: false, started_waiting: true });
        assert_eq!(accept(&mut r, "a", 7, "waiting_you", None, 4.0), Outcome::Accepted { is_new_session: false, started_waiting: false });
        assert!(r.is_any_waiting(4.0));
    }

    #[test]
    fn the_viewer_gets_its_own_rising_seq_and_only_changes() {
        let mut r = registry(Arc::new(Mutex::new(true)));
        accept(&mut r, "a", 100, "working", None, 0.0);
        accept(&mut r, "b", 200, "idle", None, 0.0);
        assert_eq!(states(&r.pending_pushes(0.0)), vec![("working".into(), 1), ("idle".into(), 1)]);
        assert!(r.pending_pushes(1.0).is_empty());
        // Quiet for 30 min without a pid: idle.
        assert_eq!(states(&r.pending_pushes(STALE_AFTER + 1.0)), vec![("idle".into(), 2)]);
        assert_eq!(states(&r.replay_bodies(STALE_AFTER + 1.0)), vec![("idle".into(), 3), ("idle".into(), 2)]);
    }

    #[test]
    fn a_dead_pid_ends_the_session_and_its_tab_expires() {
        let alive = Arc::new(Mutex::new(true));
        let mut r = registry(alive.clone());
        accept(&mut r, "a", 1, "working", Some(9), 0.0);
        assert_eq!(r.active_count(0.0), 1);
        *alive.lock().unwrap() = false;
        assert_eq!(r.reconcile(10.0), vec!["a".to_string()]);
        assert!(r.reconcile(11.0).is_empty());
        assert!(r.expire_ended(39.0).is_empty());
        assert_eq!(r.expire_ended(40.0), vec!["a".to_string()]);
        assert!(r.session("a").is_none());
    }

    #[test]
    fn idle_after_five_minutes_without_work() {
        let mut r = registry(Arc::new(Mutex::new(true)));
        accept(&mut r, "a", 1, "working", None, 10.0);
        assert!(!r.is_idle(100.0));
        accept(&mut r, "a", 2, "idle", None, 120.0);
        assert!(!r.is_idle(120.0 + IDLE_AFTER));
        assert!(r.is_idle(121.0 + IDLE_AFTER));
    }

    #[test]
    fn what_brings_the_panel_back() {
        let new = Outcome::Accepted { is_new_session: true, started_waiting: false };
        let same = Outcome::Accepted { is_new_session: false, started_waiting: false };
        let waits = Outcome::Accepted { is_new_session: false, started_waiting: true };
        assert!(should_show(same, SessionState::Working, true, HiddenBy::Idle));
        assert!(!should_show(same, SessionState::Working, true, HiddenBy::User));
        assert!(should_show(new, SessionState::Working, true, HiddenBy::User));
        assert!(should_show(waits, SessionState::WaitingYou, true, HiddenBy::User));
        assert!(!should_show(new, SessionState::Idle, true, HiddenBy::Nobody));
        assert!(!should_show(new, SessionState::Working, false, HiddenBy::Nobody));
        assert!(!should_show(Outcome::Stale, SessionState::Working, true, HiddenBy::Nobody));
        assert!(!reopen_shows(HiddenBy::Idle));
        assert!(reopen_shows(HiddenBy::User));
    }
}
