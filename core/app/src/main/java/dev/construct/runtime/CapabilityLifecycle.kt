package dev.construct.runtime

/** Historical identifiers are readable for upgrades, never executable authority. */
internal object CapabilityLifecycle {
    val retired = setOf("sky.watch")
    const val updateMessage = "This version needs an update to run on this Construct release. Saved data is kept. Browse your catalog for a supported version."
    fun needsUpdate(manifest: ModuleManifest) = manifest.capabilities.any { !it.optional && it.id in retired }
    fun requireRunnable(manifest: ModuleManifest) {
        checkRule(!needsUpdate(manifest), "MODULE_UPDATE_REQUIRED", updateMessage)
    }
    fun requireAvailable(capability: String) {
        checkRule(capability !in retired, "CAPABILITY_RETIRED", "This capability has been retired. Update the module from your catalog.")
    }
    fun validateHistoricalApi(capabilities: List<Capability>, api: String) {
        checkRule(capabilities.none { it.id in retired } || api in setOf("0.8.0", "0.9.0", "0.10.0"),
            "API_INCOMPATIBLE", "Historical capability requires Construct API 0.8.0 or later")
    }
}
