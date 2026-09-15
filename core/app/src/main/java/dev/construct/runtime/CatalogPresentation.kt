package dev.construct.runtime

import java.util.Locale

/** Presentation only: callers must retain the normal package verification/install path. */
internal data class CatalogModuleCard(
    val latest: CatalogVersion,
    val otherVersions: List<CatalogVersion>
)

internal object CatalogPresentation {
    // Packages.catalog already validates canonical major.minor.patch strings.
    // Compare decimal components without Int/Long overflow (schema permits 50 chars).
    private val versionOrder = Comparator<CatalogVersion> { left, right ->
        val a = left.version.split('.')
        val b = right.version.split('.')
        (0..2).firstNotNullOfOrNull { i ->
            val result = a[i].length.compareTo(b[i].length).takeIf { it != 0 }
                ?: a[i].compareTo(b[i])
            result.takeIf { it != 0 }
        } ?: 0
    }

    fun cards(validatedCatalog: List<CatalogVersion>): List<CatalogModuleCard> =
        validatedCatalog.groupBy { it.id }.values.map { versions ->
            val descending = versions.sortedWith(versionOrder.reversed())
            // A deliberately broken test release must not replace a usable default.
            // A test-only module remains visible and carries its fixture warning.
            val latest = descending.firstOrNull { !it.testFixture } ?: descending.first()
            CatalogModuleCard(latest, descending.filter { it !== latest })
        }.sortedWith(compareBy<CatalogModuleCard> { it.latest.name.lowercase(Locale.ROOT) }
            .thenBy { it.latest.id })
}
