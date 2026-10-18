package dev.construct.runtime

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer

class AstraEnvelopeHeaderTest {
    private fun envelope(zipSize: String = "1", format: String = "construct-encrypted-v1"): ByteArray {
        val text = """{"format":"$format","id":"sealed.a0123456789abcdef0123456789abcdef","version":"1.0.0","keyId":"0123456789abcdef0123456789abcdef","zipBytes":$zipSize,"manifestCommitment":"${"0".repeat(64)}"}"""
        val header = text.toByteArray(Charsets.UTF_8)
        return "CENC0001".toByteArray() + ByteBuffer.allocate(4).putInt(header.size).array() + header + ByteArray(12 + 32 + 1 + 16)
    }
    private fun result(bytes: ByteArray): String = try { EncryptedPackages.parse(bytes); "ACCEPTED" } catch (e: ConstructError) { e.code }
    @Test fun asciiHeaderRemainsAccepted() { assertEquals("ACCEPTED", result(envelope())) }
    @Test fun nonJsonUnicodeIntegerMustBeRejected() {
        assertEquals("PACKAGE_INVALID", result(envelope(zipSize = "١")))
    }
    @Test fun signedUnicodeEscapeMustBeRejected() {
        assertEquals("PACKAGE_INVALID", result(envelope(format = "\\u+063onstruct-encrypted-v1")))
    }
}
