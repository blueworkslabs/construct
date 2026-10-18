package dev.construct.runtime

/**
 * Pending unlocks (docs/encrypted-packages.md: cancellation, leaving preparation or backgrounding
 * before consent discard the candidate). An unlock takes a token when it starts on the Browse
 * screen. [leave] runs when Construct stops or the person leaves that screen (Back, Library,
 * Settings, About, Diagnostics, Module access). A result is shown only while its token is still
 * current and Browse is still the screen, so a decrypt that finishes elsewhere is dropped and
 * the person unlocks again.
 */
internal class PreparationGate {
    @Volatile private var generation = 0
    fun begin(): Int = generation
    fun leave() { generation++ }
    fun deliverable(token: Int, onPreparationScreen: Boolean): Boolean = onPreparationScreen && token == generation
}
