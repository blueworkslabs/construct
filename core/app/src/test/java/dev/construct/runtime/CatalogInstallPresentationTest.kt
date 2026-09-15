package dev.construct.runtime

import org.junit.Assert.*
import org.junit.Test

class CatalogInstallPresentationTest {
    private fun release(version: String = "0.2.0", fixture: Boolean = false) =
        CatalogVersion("dev.test.tool", "Tool", version, "tool.zip", "new-digest", "signature", fixture)
    private fun installed(version: String = "0.1.0", confirmed: Boolean = true, digest: String = "old-digest") =
        CatalogInstalledState(version, digest, confirmed)

    @Test fun prominentCardNeverSuggestsDowngradeButExplicitHistoryAllowsReview() {
        val current = installed("0.10.0")
        val prominent = CatalogInstallPresentation.choice(release(), current)
        assertFalse(prominent.enabled)
        assertEquals("Newer version installed", prominent.label)
        val history = CatalogInstallPresentation.choice(release(), current, explicitVersion = true)
        assertTrue(history.enabled)
        assertEquals("Review older version", history.label)
    }
    @Test fun updateOrderingHandlesVeryLargeNumericComponents() {
        assertEquals("Update", CatalogInstallPresentation.choice(release("999999999999999999999.0.0"), installed("10.0.0")).label)
        assertEquals("Newer version installed", CatalogInstallPresentation.choice(release("9.0.0"), installed("999999999999999999999.0.0")).label)
    }
    @Test fun exactArtifactIsInstalledButSameVersionDifferentArtifactNeedsReview() {
        assertFalse(CatalogInstallPresentation.choice(release(), installed(digest = "new-digest")).enabled)
        val replacement = CatalogInstallPresentation.choice(release(), installed("0.2.0"))
        assertEquals("Review replacement", replacement.label)
        assertTrue(replacement.enabled)
    }
    @Test fun unconfirmedTrialBlocksBothLatestAndHistory() {
        for (explicit in listOf(false, true)) {
            val result = CatalogInstallPresentation.choice(release(), installed(confirmed = false), explicitVersion = explicit)
            assertFalse(result.enabled)
            assertEquals("Test current version first", result.label)
        }
    }
    @Test fun repairAndBusyGatesAlsoApplyToExplicitHistory() {
        assertFalse(CatalogInstallPresentation.choice(release(), null, indexUnreadable = true, explicitVersion = true).enabled)
        assertFalse(CatalogInstallPresentation.choice(release(), installed(), damaged = true, explicitVersion = true).enabled)
        assertFalse(CatalogInstallPresentation.choice(release(), installed(), busy = true, explicitVersion = true).enabled)
    }
    @Test fun fixturesRemainExplicitAndNormalFreshInstallHasClearAction() {
        assertEquals("Install", CatalogInstallPresentation.choice(release(), null).label)
        assertEquals("Install for testing", CatalogInstallPresentation.choice(release(fixture = true), null).label)
        assertEquals("Review test version", CatalogInstallPresentation.choice(release(fixture = true), installed()).label)
    }
}
