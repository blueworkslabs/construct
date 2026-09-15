package dev.construct.runtime

import org.junit.Assert.*
import org.junit.Test

class CatalogPresentationTest {
    private fun entry(version: String, id: String = "dev.construct.hello", name: String = "Hello", fixture: Boolean = false) =
        CatalogVersion(id, name, version, "$id-$version.zip", "hash-$version", "signature-$version", fixture)

    @Test fun numericOrderIsIndependentOfRegistryOrder() {
        val entries = listOf(entry("0.2.9"), entry("0.2.10"), entry("0.1.99"))
        for (input in listOf(entries, entries.reversed())) {
            val card = CatalogPresentation.cards(input).single()
            assertEquals("0.2.10", card.latest.version)
            assertEquals(listOf("0.2.9", "0.1.99"), card.otherVersions.map { it.version })
        }
    }
    @Test fun numericComponentsDoNotOverflow() {
        val card = CatalogPresentation.cards(listOf(entry("99999999999999999999.0.0"), entry("100000000000000000000.0.0"))).single()
        assertEquals("100000000000000000000.0.0", card.latest.version)
    }
    @Test fun brokenFixtureStaysExplicitInHistoryInsteadOfBecomingDefault() {
        val stable = entry("0.2.0")
        val broken = entry("0.2.1", fixture = true)
        val card = CatalogPresentation.cards(listOf(broken, stable)).single()
        assertSame(stable, card.latest)
        assertSame(broken, card.otherVersions.single())
        assertTrue(card.otherVersions.single().testFixture)
    }
    @Test fun testOnlyModuleRemainsVisibleAndMarked() {
        val card = CatalogPresentation.cards(listOf(entry("0.1.0", fixture = true), entry("0.1.4", fixture = true))).single()
        assertEquals("0.1.4", card.latest.version)
        assertTrue(card.latest.testFixture)
        assertEquals(1, card.otherVersions.size)
    }
    @Test fun moduleIdentityIsNotItsDisplayNameAndArtifactsArePreserved() {
        val a = entry("0.1.0", "dev.construct.a", "Same")
        val b = entry("0.2.0", "dev.construct.b", "Same")
        val input = listOf(b, a)
        val cards = CatalogPresentation.cards(input)
        assertEquals(listOf("dev.construct.a", "dev.construct.b"), cards.map { it.latest.id })
        assertSame(a, cards[0].latest)
        assertSame(b, cards[1].latest)
        assertEquals(listOf(b, a), input)
    }
    @Test fun emptyCatalogAndSingletonNeedNoHistory() {
        assertTrue(CatalogPresentation.cards(emptyList()).isEmpty())
        assertTrue(CatalogPresentation.cards(listOf(entry("0.1.0"))).single().otherVersions.isEmpty())
    }
}
