package dev.construct.runtime

/** Historical identifiers are readable for upgrades, never executable authority. */
internal object CapabilityLifecycle {
    private val historicalApis = mapOf(
        "sky.watch" to setOf("0.8.0", "0.9.0", "0.10.0", "0.11.0"),
        "photo.measure" to setOf("0.7.0", "0.8.0", "0.9.0", "0.10.0", "0.11.0"),
    )
    val retired = historicalApis.keys
    const val updateMessage = "This version needs an update to run on this Construct release. Saved data is kept. Browse your catalog for a supported version."
    fun needsUpdate(manifest: ModuleManifest) = manifest.capabilities.any { !it.optional && it.id in retired }
    fun requireRunnable(manifest: ModuleManifest) {
        checkRule(!needsUpdate(manifest), "MODULE_UPDATE_REQUIRED", updateMessage)
    }
    fun requireAvailable(capability: String) {
        checkRule(capability !in retired, "CAPABILITY_RETIRED", "This capability has been retired. Update the module from your catalog.")
    }
    fun validateHistoricalApi(capabilities: List<Capability>, api: String) {
        checkRule(capabilities.all { historicalApis[it.id]?.contains(api) != false },
            "API_INCOMPATIBLE", "Historical capability requires its original API version or later")
    }
}
