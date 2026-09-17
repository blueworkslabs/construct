package dev.construct.runtime

/** Snapshot for presentation only, never an authorization to install. */
internal data class CatalogInstalledState(val version: String, val digest: String, val confirmed: Boolean, val needsUpdate: Boolean = false)
internal data class CatalogInstallChoice(val label: String, val enabled: Boolean, val explanation: String? = null)

internal object CatalogInstallPresentation {
    /** Explicit Versions review may select older code. The prominent card never promotes a downgrade. */
    fun choice(
        release: CatalogVersion,
        current: CatalogInstalledState?,
        busy: Boolean = false,
        indexUnreadable: Boolean = false,
        damaged: Boolean = false,
        explicitVersion: Boolean = false
    ): CatalogInstallChoice {
        if (indexUnreadable) return CatalogInstallChoice("Repair index first", false, "Repair the module index in Library before installing code.")
        if (damaged) return CatalogInstallChoice("Repair module first", false, "Restore or remove this module from Library. Saved data is kept.")
        if (current?.digest == release.sha256) return CatalogInstallChoice("Installed", false)
        if (current != null && !current.confirmed && !current.needsUpdate) return CatalogInstallChoice("Test current version first", false,
            "Open the current trial and mark it working from its menu, or restore/discard it from Library.")
        val comparison = current?.let { CatalogPresentation.compareVersions(release.version, it.version) }
        if (!explicitVersion && comparison != null && comparison < 0) return CatalogInstallChoice("Newer version installed", false,
            "Use Versions to explicitly review older code.")
        val label = when {
            release.testFixture -> if (current == null) "Install for testing" else "Review test version"
            current == null -> "Install"
            comparison == 0 -> "Review replacement"
            comparison != null && comparison < 0 -> "Review older version"
            else -> "Update"
        }
        return CatalogInstallChoice(label, !busy, if (busy) "Another operation is in progress." else null)
    }
}
