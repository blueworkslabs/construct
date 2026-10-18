package dev.construct.runtime

import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** One `encryptedModules` catalog version (docs/encrypted-packages.md, v1). Opaque by design. */
data class EncryptedCatalogVersion(val id: String, val version: String, val artifact: String,
    val sha256: String, val signature: String)

/** The authenticated, not yet decrypted, framing of a `construct-encrypted-v1` envelope. */
data class EnvelopeHeader(val id: String, val version: String, val keyId: String,
    val zipBytes: Int, val manifestCommitment: String)

/**
 * Host side of `construct-encrypted-v1` (docs/encrypted-packages.md). The order is fixed:
 * hash and publisher signature over every envelope byte, then the strict header, then the
 * catalog binding, then the one matching key, then AES-256-GCM, and only after GCM succeeds
 * the plaintext length, the salted manifest commitment and the ordinary package validator.
 * Nothing decrypted is parsed, shown or logged before GCM finalization succeeds.
 */
object EncryptedPackages {
    const val FORMAT = "construct-encrypted-v1"
    const val LABEL = "Locked module"
    const val MAX_ENVELOPE = 4 * 1024 * 1024
    const val MAX_HEADER = 4096
    private const val NONCE = 12
    private const val TAG = 16
    private const val SALT = 32
    private val MAGIC = "CENC0001".toByteArray(Charsets.US_ASCII)
    private val HEADER_FIELDS = setOf("format", "id", "version", "keyId", "zipBytes", "manifestCommitment")
    val opaqueId = Regex("sealed\\.a[0-9a-f]{32}")
    private val hex32 = Regex("[0-9a-f]{32}")
    private val hex64 = Regex("[0-9a-f]{64}")
    private val versionPattern = Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")
    private val COMMITMENT_PREFIX = "ConstructManifestV1".toByteArray(Charsets.US_ASCII) + byteArrayOf(0)

    private fun invalid(detail: String): Nothing = throw ConstructError("PACKAGE_INVALID", "Package validation failed ($detail)")

    fun isEnvelope(bytes: ByteArray) = bytes.size >= MAGIC.size && bytes.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)

    /** Strict framing and header. Returns the header and the exact AAD prefix length. */
    fun parse(envelope: ByteArray): Pair<EnvelopeHeader, Int> {
        if (envelope.size > MAX_ENVELOPE) invalid("envelope size")
        if (envelope.size < 12 || !isEnvelope(envelope)) invalid("magic")
        val length = ((envelope[8].toLong() and 0xff) shl 24) or ((envelope[9].toLong() and 0xff) shl 16) or
            ((envelope[10].toLong() and 0xff) shl 8) or (envelope[11].toLong() and 0xff)
        if (length < 1 || length > MAX_HEADER) invalid("header length")
        val end = 12 + length.toInt()
        if (envelope.size < end + NONCE + TAG) invalid("truncated")
        val text = try {
            Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(envelope, 12, length.toInt())).toString()
        } catch (_: java.nio.charset.CharacterCodingException) { invalid("header UTF-8") }
        val fields = StrictHeaderJson(text).parse()
        if (fields.keys != HEADER_FIELDS) invalid("header fields")
        if (fields["format"] != FORMAT) throw ConstructError("PACKAGE_FORMAT_UNSUPPORTED", "Update Construct to open this package")
        val id = fields["id"] as? String ?: invalid("opaque ID")
        val version = fields["version"] as? String ?: invalid("version")
        val keyId = fields["keyId"] as? String ?: invalid("key ID")
        val zipBytes = fields["zipBytes"] as? Long ?: invalid("ZIP length")
        val commitment = fields["manifestCommitment"] as? String ?: invalid("manifest commitment")
        if (!opaqueId.matches(id)) invalid("opaque ID")
        if (!versionPattern.matches(version) || version.length > 50) invalid("version")
        if (!hex32.matches(keyId)) invalid("key ID")
        if (zipBytes < 1 || zipBytes > Packages.MAX_ZIP) invalid("ZIP length")
        if (!hex64.matches(commitment)) invalid("manifest commitment")
        if (envelope.size - end - NONCE != SALT + zipBytes.toInt() + TAG) invalid("ciphertext length")
        return EnvelopeHeader(id, version, keyId, zipBytes.toInt(), commitment) to end
    }

    /**
     * Authenticated decryption and inner validation with one content key. Callers outside
     * this object go through [verify], which authenticates the publisher first.
     */
    internal fun open(envelope: ByteArray, key: ByteArray): VerifiedPackage {
        val (header, end) = parse(envelope)
        checkRule(key.size == 32, "KEY_FORMAT", "Check the key format")
        val plain = try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG * 8, envelope, end, NONCE))
            cipher.updateAAD(envelope, 0, end)
            // doFinal only: no incremental plaintext reaches anything before the tag is checked.
            cipher.doFinal(envelope, end + NONCE, envelope.size - end - NONCE)
        } catch (_: AEADBadTagException) {
            throw ConstructError("PACKAGE_WRONG_KEY", "This key cannot unlock this package")
        }
        if (plain.size != SALT + header.zipBytes) invalid("plaintext length")
        val salt = plain.copyOfRange(0, SALT)
        val blob = plain.copyOfRange(SALT, plain.size)
        checkZipFraming(blob)
        val files = try { Packages.zipFiles(blob) } catch (e: ConstructError) { invalid(e.code) }
        for ((name, data) in files) if (name.endsWith(".cenc") || isEnvelope(data)) invalid("nested envelope")
        val manifestBytes = files["manifest.json"] ?: invalid("manifest missing")
        if (manifestBytes.size > 32768) invalid("manifest size")
        val commitment = sha256(COMMITMENT_PREFIX + salt + manifestBytes)
        if (!MessageDigest.isEqual(commitment.toByteArray(), header.manifestCommitment.toByteArray())) invalid("manifest commitment")
        val manifest = try { Packages.checkFiles(files, header.id, header.version) } catch (e: ConstructError) { invalid(e.code) }
        return VerifiedPackage(manifest, files, sha256(envelope))
    }

    /**
     * The full encrypted install path: bounded size, catalog hash, publisher signature over
     * every envelope byte (before any key is looked up), header bound to the catalog entry,
     * then the exact key for (publisher, id, keyId), then [open].
     */
    fun verify(envelope: ByteArray, expected: EncryptedCatalogVersion, publicKey: ByteArray,
               keyFor: (EnvelopeHeader) -> ByteArray?): VerifiedPackage {
        checkRule(envelope.size <= MAX_ENVELOPE, "PACKAGE_SIZE", "Package is too large")
        checkRule(sha256(envelope) == expected.sha256, "CHECKSUM_FAILED", "Package download is damaged or changed")
        val verifier = Signature.getInstance("SHA256withRSA")
        verifier.initVerify(KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(publicKey)))
        verifier.update(envelope)
        checkRule(verifier.verify(Base64.getDecoder().decode(expected.signature)), "SIGNATURE_FAILED", "Package is not signed by the trusted publisher")
        val (header, _) = parse(envelope)
        if (header.id != expected.id || header.version != expected.version) invalid("outer binding")
        val key = keyFor(header) ?: throw ConstructError("PACKAGE_LOCKED", "Add the matching key in Settings")
        try { return open(envelope, key) } finally { key.fill(0) }
    }

    /** Exact ZIP framing: a local header first; the comment-free end record as the last 22 bytes. */
    private fun checkZipFraming(blob: ByteArray) {
        val n = blob.size
        fun u16(i: Int) = (blob[i].toInt() and 0xff) or ((blob[i + 1].toInt() and 0xff) shl 8)
        fun u32(i: Int) = u16(i).toLong() or (u16(i + 2).toLong() shl 16)
        if (n < 22 || u32(0) != 0x04034b50L || u32(n - 22) != 0x06054b50L) invalid("ZIP framing")
        if (u16(n - 2) != 0 || u32(n - 6) + u32(n - 10) != (n - 22).toLong()) invalid("ZIP framing")
    }

    fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}

/**
 * A deliberately small JSON reader for the envelope header: one flat object whose values are
 * strings or non-negative integers. Duplicate keys, nesting, booleans, null, fractions,
 * exponents, leading zeros and trailing data are all rejected (org.json keeps the last of
 * duplicate keys, which the format forbids).
 */
private class StrictHeaderJson(private val s: String) {
    private var i = 0
    private fun fail(): Nothing = throw ConstructError("PACKAGE_INVALID", "Package validation failed (header JSON)")
    private fun ws() { while (i < s.length && s[i] in " \t\r\n") i++ }
    private fun expect(c: Char) { ws(); if (i >= s.length || s[i] != c) fail(); i++ }
    fun parse(): Map<String, Any> {
        val out = linkedMapOf<String, Any>()
        expect('{'); ws()
        if (i < s.length && s[i] == '}') { i++ } else {
            while (true) {
                ws(); val key = string(); expect(':'); ws()
                val value: Any = if (i < s.length && s[i] == '"') string() else number()
                if (out.put(key, value) != null) fail()
                ws(); if (i >= s.length) fail()
                if (s[i] == ',') { i++; continue }
                if (s[i] == '}') { i++; break }
                fail()
            }
        }
        ws(); if (i != s.length) fail()
        return out
    }
    private fun string(): String {
        if (i >= s.length || s[i] != '"') fail(); i++
        val b = StringBuilder()
        while (true) {
            if (i >= s.length) fail()
            val c = s[i++]
            when {
                c == '"' -> return b.toString()
                c == '\\' -> {
                    if (i >= s.length) fail()
                    when (val e = s[i++]) {
                        '"', '\\', '/' -> b.append(e)
                        'b' -> b.append('\b')
                        'f' -> b.append('\u000c')
                        'n' -> b.append('\n')
                        'r' -> b.append('\r')
                        't' -> b.append('\t')
                        'u' -> { if (i + 4 > s.length) fail(); b.append(s.substring(i, i + 4).toIntOrNull(16)?.toChar() ?: fail()); i += 4 }
                        else -> fail()
                    }
                }
                c < ' ' -> fail()
                else -> b.append(c)
            }
        }
    }
    private fun number(): Long {
        val start = i
        while (i < s.length && s[i].isDigit()) i++
        val text = s.substring(start, i)
        if (text.isEmpty() || text.length > 10 || (text.length > 1 && text[0] == '0')) fail()
        return text.toLong()
    }
}
