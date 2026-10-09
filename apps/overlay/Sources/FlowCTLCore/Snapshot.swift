import Foundation

/// The session states of a Snapshot (mod/graph/types.ts).
public enum SessionState: String, Equatable {
    case working
    case waitingYou = "waiting_you"
    case idle
    case ended

    /// A session the person may want to watch: the agent works or waits on them.
    public var isActive: Bool { self == .working || self == .waitingYou }
}

/// What the overlay reads of a Snapshot; the page reads the rest.
public struct SnapshotInfo: Equatable {
    public let sessionId: String
    public let seq: Int
    public let state: SessionState
    /// Milliseconds since 1970, as the mod writes it.
    public let updatedAt: Double
    public let nodeCount: Int

    public init(sessionId: String, seq: Int, state: SessionState, updatedAt: Double, nodeCount: Int) {
        self.sessionId = sessionId
        self.seq = seq
        self.state = state
        self.updatedAt = updatedAt
        self.nodeCount = nodeCount
    }
}

public enum SnapshotError: Error, Equatable {
    case notJSONObject
    case wrongSchema
    case missingField(String)
}

public enum Snapshot {
    public static let schema = 1

    /// Reads the fields the overlay needs and checks the shape the viewer
    /// expects; the body itself goes to the page untouched.
    public static func parse(_ data: Data) -> Result<SnapshotInfo, SnapshotError> {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return .failure(.notJSONObject)
        }
        guard (object["schema"] as? NSNumber)?.intValue == schema else { return .failure(.wrongSchema) }
        guard let sessionId = object["sessionId"] as? String, !sessionId.isEmpty else {
            return .failure(.missingField("sessionId"))
        }
        guard let seq = object["seq"] as? NSNumber, seq.doubleValue == seq.doubleValue.rounded() else {
            return .failure(.missingField("seq"))
        }
        guard let rawState = object["sessionState"] as? String, let state = SessionState(rawValue: rawState) else {
            return .failure(.missingField("sessionState"))
        }
        guard let nodes = object["nodes"] as? [Any] else { return .failure(.missingField("nodes")) }
        guard object["layout"] is [String: Any] else { return .failure(.missingField("layout")) }
        let updatedAt = (object["updatedAt"] as? NSNumber)?.doubleValue ?? 0
        return .success(SnapshotInfo(sessionId: sessionId, seq: seq.intValue, state: state, updatedAt: updatedAt, nodeCount: nodes.count))
    }
}
