import Foundation

/// The snapshot files the mod leaves in ~/.flowctl/sessions: which to show
/// when the overlay opens, and which to delete (the mod cannot delete files).
public enum SessionFiles {
    public static let maxAge: TimeInterval = 24 * 60 * 60

    public struct Entry: Equatable {
        public let name: String
        public let data: Data
        public let modified: Date

        public init(name: String, data: Data, modified: Date) {
            self.name = name
            self.data = data
            self.modified = modified
        }
    }

    public struct Plan: Equatable {
        /// Sessions to show, oldest update first.
        public var show: [Entry] = []
        /// File names to delete.
        public var delete: [String] = []
    }

    /// Ended sessions, sessions whose pid is gone, and files older than a day
    /// go; the rest are shown, oldest update first. A file that does not parse
    /// is left alone while fresh: the mod may be writing it right now.
    public static func plan(_ entries: [Entry], now: Date, isAlive: (Int32) -> Bool) -> Plan {
        var plan = Plan()
        var shown: [(SnapshotInfo, Entry)] = []
        for entry in entries where entry.name.hasSuffix(".json") {
            let isOld = now.timeIntervalSince(entry.modified) > maxAge
            switch Snapshot.parse(entry.data) {
            case .failure:
                if isOld { plan.delete.append(entry.name) }
            case .success(let info):
                let gone = info.pid.map { !isAlive($0) } ?? false
                if isOld || info.state == .ended || gone {
                    plan.delete.append(entry.name)
                } else {
                    shown.append((info, entry))
                }
            }
        }
        plan.show = shown.sorted { $0.0.updatedAt < $1.0.updatedAt }.map(\.1)
        plan.delete.sort()
        return plan
    }

    /// Reads the directory; a missing one has no entries.
    public static func read(directory: URL) -> [Entry] {
        let manager = FileManager.default
        guard let names = try? manager.contentsOfDirectory(atPath: directory.path) else { return [] }
        return names.sorted().compactMap { name in
            let url = directory.appendingPathComponent(name)
            guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .contentModificationDateKey]),
                  values.isRegularFile == true,
                  let data = try? Data(contentsOf: url)
            else { return nil }
            return Entry(name: name, data: data, modified: values.contentModificationDate ?? .distantPast)
        }
    }
}
