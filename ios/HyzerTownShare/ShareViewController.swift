import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    private let appGroup = "group.com.anonymous.hyzer-town"
    private let pendingFilename = "pending_import.csv"

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        extractCSV { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    self?.finish(message: "Rounds saved to Hyzer Town.\nOpen the app to import.")
                case .failure(let err):
                    self?.finish(message: "Import failed: \(err.localizedDescription)")
                }
            }
        }
    }

    // MARK: - CSV extraction

    private func extractCSV(completion: @escaping (Result<Void, Error>) -> Void) {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachment = item.attachments?.first else {
            completion(.failure(ShareError.noAttachment))
            return
        }

        let csvType = UTType.commaSeparatedText.identifier
        let plainType = UTType.plainText.identifier
        let fileType  = UTType.fileURL.identifier

        let typeToLoad = [csvType, plainType, fileType].first {
            attachment.hasItemConformingToTypeIdentifier($0)
        } ?? csvType

        attachment.loadItem(forTypeIdentifier: typeToLoad, options: nil) { [weak self] item, error in
            if let error { completion(.failure(error)); return }

            var csvString: String?
            if let url = item as? URL {
                csvString = try? String(contentsOf: url, encoding: .utf8)
            } else if let str = item as? String {
                csvString = str
            } else if let data = item as? Data {
                csvString = String(data: data, encoding: .utf8)
            }

            guard let csv = csvString, !csv.isEmpty else {
                completion(.failure(ShareError.unreadable)); return
            }
            self?.saveCSV(csv, completion: completion)
        }
    }

    private func saveCSV(_ csv: String, completion: @escaping (Result<Void, Error>) -> Void) {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            completion(.failure(ShareError.noContainer)); return
        }
        let dest = container.appendingPathComponent(pendingFilename)
        do {
            try csv.write(to: dest, atomically: true, encoding: .utf8)
            completion(.success(()))
        } catch {
            completion(.failure(error))
        }
    }

    // MARK: - UI

    private func finish(message: String) {
        let label = UILabel()
        label.text = message
        label.textColor = .white
        label.font = .systemFont(ofSize: 15, weight: .medium)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false

        view.backgroundColor = UIColor(red: 0.08, green: 0.16, blue: 0.10, alpha: 1)
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
        ])

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }

    // MARK: - Errors

    enum ShareError: LocalizedError {
        case noAttachment, unreadable, noContainer
        var errorDescription: String? {
            switch self {
            case .noAttachment: return "No file was shared."
            case .unreadable:   return "Could not read the CSV file."
            case .noContainer:  return "App Group container not found."
            }
        }
    }
}
