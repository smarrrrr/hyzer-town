import ExpoModulesCore

// Extends the auto-generated ExpoModulesProvider to register local modules
// that the autolinking system can't pick up from node_modules.
class AppModulesProvider: ExpoModulesProvider {
    public override func getModuleClasses() -> [AnyModule.Type] {
        return super.getModuleClasses() + [SharedStorageModule.self]
    }
}
