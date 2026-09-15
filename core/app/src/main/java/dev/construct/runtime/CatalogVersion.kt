package dev.construct.runtime

data class CatalogVersion(val id: String, val name: String, val version: String,
    val artifact: String, val sha256: String, val signature: String, val testFixture: Boolean = false)
