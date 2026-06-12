internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    copyPendingCSVToDocuments()
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  public override func applicationDidBecomeActive(_ application: UIApplication) {
    super.applicationDidBecomeActive(application)
    copyPendingCSVToDocuments()
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

private func copyPendingCSVToDocuments() {
  let appGroup = "group.com.anonymous.hyzer-town"
  let filename = "pending_import.csv"
  let fm = FileManager.default
  var log = ["time": ISO8601DateFormatter().string(from: Date())] as [String: String]

  guard let container = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
    log["result"] = "no_container"
    writeDebugLog(log); return
  }
  log["container"] = container.path

  let src = container.appendingPathComponent(filename)
  log["src_exists"] = fm.fileExists(atPath: src.path) ? "yes" : "no"

  guard fm.fileExists(atPath: src.path),
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first else {
    log["result"] = "no_src_or_docs"
    writeDebugLog(log); return
  }

  let dest = docs.appendingPathComponent(filename)
  try? fm.removeItem(at: dest)
  do {
    try fm.copyItem(at: src, to: dest)
    try? fm.removeItem(at: src)
    log["result"] = "copied_ok"
  } catch {
    log["result"] = "copy_failed: \(error)"
  }
  writeDebugLog(log)
}

private func writeDebugLog(_ log: [String: String]) {
  guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
  let url = docs.appendingPathComponent("share_debug.json")
  if let data = try? JSONSerialization.data(withJSONObject: log) {
    try? data.write(to: url)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
