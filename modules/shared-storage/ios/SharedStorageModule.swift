import ExpoModulesCore

public class SharedStorageModule: Module {
    private let appGroup = "group.com.anonymous.hyzer-town"
    private let filename = "pending_import.csv"

    public func definition() -> ModuleDefinition {
        Name("SharedStorage")

        // Returns the pending CSV string written by the Share Extension, or nil if none.
        Function("getPendingCSV") { () -> String? in
            guard let container = FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: self.appGroup) else { return nil }
            let url = container.appendingPathComponent(self.filename)
            guard FileManager.default.fileExists(atPath: url.path) else { return nil }
            return try? String(contentsOf: url, encoding: .utf8)
        }

        // Deletes the pending CSV after a successful import.
        Function("clearPendingCSV") {
            guard let container = FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: self.appGroup) else { return }
            let url = container.appendingPathComponent(self.filename)
            try? FileManager.default.removeItem(at: url)
        }
    }
}
