package dev.construct.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

class RegistryDefaultTest {
    private val publicCatalog = "https://construct-20x.pages.dev/index.json"

    @Test fun freshDeploymentStartsWithConfiguredCatalog() {
        assertEquals(publicCatalog, initialRegistry(null, publicCatalog))
    }

    @Test fun unconfiguredSourceBuildKeepsOfflineDemo() {
        assertEquals("demo", initialRegistry(null, ""))
        assertEquals("demo", initialRegistry(null, "  "))
    }

    @Test fun explicitOfflineDemoSurvivesConfiguredUpgrade() {
        assertEquals("demo", initialRegistry("demo", publicCatalog))
    }

    @Test fun savedCustomCatalogIsNotReplacedByNewDefault() {
        val custom = "https://modules.example.org/index.json"
        assertEquals(custom, initialRegistry(custom, publicCatalog))
    }
}
