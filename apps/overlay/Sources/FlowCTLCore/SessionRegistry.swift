import Foundation

/// The sessions the overlay shows, with the rules for when the panel shows
/// and hides itself. Pure: the clock is passed in.
public struct SessionRegistry {
    /// How long an ended session's tab stays up.
    public static let endedTabLifetime: TimeInterval = 30
    /// Without a pid, a session that is working or waiting but has not been
    /// written for this long is presumed dead (its process left without a
    /// session.end): it counts as neither active nor waiting.
    public static let staleAfter: TimeInterval = 30 * 60
    /// No active session for longer than this is idle: the panel hides (`Hide When Idle`).
    public static let idleAfter: TimeInterval = 5 * 60

    public struct Session: Equatable {
        public let info: SnapshotInfo
        /// The snapshot as received, to push again after a page reload.
        public let body: Data
        public let lastSeen: Date
        public let endedAt: Date?
    }

    public enum Outcome: Equatable {
        /// Not newer than what is shown for that session: dropped.
        case stale
        case accepted(isNewSession: Bool, startedWaiting: Bool)
    }

    public private(set) var sessions: [String: Session] = [:]
    /// Session ids in the order they first arrived.
    public private(set) var order: [String] = []
    private var lastActiveAt: Date
    private let idleAfter: TimeInterval
    private let isAlive: (Int32) -> Bool

    /// `now`: when the overlay opened; idleness is counted from there.
    /// `idleAfter` is the production limit unless a test shortens it, and
    /// `isAlive` asks whether a session's pid still runs (a test answers it).
    public init(
        now: Date,
        idleAfter: TimeInterval = SessionRegistry.idleAfter,
        isAlive: @escaping (Int32) -> Bool = ProcessLiveness.isAlive
    ) {
        lastActiveAt = now
        self.idleAfter = idleAfter
        self.isAlive = isAlive
    }

    /// `now`: when the snapshot was seen (a file's modification date, for one
    /// read from disk at launch).
    public mutating func accept(_ info: SnapshotInfo, body: Data, now: Date) -> Outcome {
        let previous = sessions[info.sessionId]
        if let previous, info.seq <= previous.info.seq { return .stale }

        let endedAt = info.state == .ended ? (previous?.endedAt ?? now) : nil
        sessions[info.sessionId] = Session(info: info, body: body, lastSeen: now, endedAt: endedAt)
        if previous == nil { order.append(info.sessionId) }
        // A session that was active until this snapshot counts as active until now.
        if info.state.isActive || previous?.info.state.isActive == true { lastActiveAt = max(lastActiveAt, now) }
        let startedWaiting = info.state == .waitingYou && previous?.info.state != .waitingYou
        return .accepted(isNewSession: previous == nil, startedWaiting: startedWaiting)
    }

    /// Drops sessions that ended at least `endedTabLifetime` ago; returns their ids.
    /// A session marked by `reconcile` ended when its pid went away.
    public mutating func expireEnded(now: Date) -> [String] {
        let expired = order.filter { id in
            guard let endedAt = sessions[id]?.endedAt else { return false }
            return now.timeIntervalSince(endedAt) >= Self.endedTabLifetime
        }
        for id in expired { sessions[id] = nil }
        order.removeAll { expired.contains($0) }
        return expired
    }

    /// The state a session counts as now. A session is ended when its pid is
    /// gone (whatever it last said), and a session without a pid that has not
    /// been written for `staleAfter` is idle: not active, not waiting.
    public func effectiveState(of session: Session, now: Date) -> SessionState {
        if session.info.state == .ended || session.endedAt != nil { return .ended }
        if let pid = session.info.pid {
            return isAlive(pid) ? session.info.state : .ended
        }
        if session.info.state.isActive, now.timeIntervalSince(session.lastSeen) > Self.staleAfter {
            return .idle
        }
        return session.info.state
    }

    public func isActive(_ session: Session, now: Date) -> Bool {
        effectiveState(of: session, now: now).isActive
    }

    public func activeCount(now: Date) -> Int {
        sessions.values.filter { isActive($0, now: now) }.count
    }

    /// Whether a session that is alive is waiting on the person (the icon's `!`).
    public func isAnyWaiting(now: Date) -> Bool {
        sessions.values.contains { effectiveState(of: $0, now: now) == .waitingYou }
    }

    /// Marks the sessions whose pid is gone as ended, as they stop counting
    /// from now, so their tabs leave like any ended session's. Returns the new ones.
    public mutating func reconcile(now: Date) -> [String] {
        var gone: [String] = []
        for id in order {
            guard let session = sessions[id], session.endedAt == nil, session.info.state != .ended,
                  let pid = session.info.pid, !isAlive(pid)
            else { continue }
            sessions[id] = Session(info: session.info, body: session.body, lastSeen: session.lastSeen, endedAt: now)
            gone.append(id)
        }
        return gone
    }

    /// True once no session has been active for longer than `idleAfter`.
    public mutating func isIdle(now: Date) -> Bool {
        if activeCount(now: now) > 0 {
            lastActiveAt = now
            return false
        }
        return now.timeIntervalSince(lastActiveAt) > idleAfter
    }

    /// The bodies to push again, in arrival order, after the page reloads.
    public var bodies: [Data] { order.compactMap { sessions[$0]?.body } }
}

/// Whether a snapshot should bring the panel up.
public enum AutoShow {
    /// `userHidden`: the person closed the panel. Then only a new session, or
    /// one that starts waiting on them, brings it back.
    public static func shouldShow(outcome: SessionRegistry.Outcome, state: SessionState, enabled: Bool, userHidden: Bool) -> Bool {
        guard enabled, state.isActive, case let .accepted(isNew, startedWaiting) = outcome else { return false }
        return !userHidden || isNew || startedWaiting
    }
}
