package dev.construct.runtime

/**
 * Invalidated whenever Construct leaves the foreground (docs/encrypted-packages.md: backgrounding
 * before consent discards a pending candidate). An unlock takes a token when it starts; its
 * result is shown only if the token is still current, so a decrypt that finishes in the
 * background is dropped and the person unlocks again in the foreground.
 */
internal class ForegroundGeneration {
    @Volatile private var value = 0
    fun token(): Int = value
    fun invalidate() { value++ }
    fun current(token: Int): Boolean = token == value
}
