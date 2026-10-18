package dev.construct.runtime

import org.json.JSONArray
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.nio.file.Files
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** The Keystore stand-in: AES-GCM under a fixed in-memory key, fresh nonce per wrap. */
internal class FakeWrapper(private val wrapping: ByteArray = ByteArray(32) { 7 }) : KeyWrapper {
    override fun wrap(plain: ByteArray, aad: ByteArray): Pair<ByteArray, ByteArray> {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(wrapping, "AES"))
        cipher.updateAAD(aad)
        val sealed = cipher.doFinal(plain)
        return cipher.iv to sealed
    }
    override fun unwrap(nonce: ByteArray, sealed: ByteArray, aad: ByteArray): ByteArray = try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(wrapping, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad)
        cipher.doFinal(sealed)
    } catch (_: Exception) { throw ConstructError("KEY_UNAVAILABLE", "Unlock the device or re-import the key") }
}

@RunWith(RobolectricTestRunner::class)
class ModuleKeysTest {
    private val publisher = "ab".repeat(32)
    private val id = "sealed.a" + "1".repeat(32)
    private val keyId = "2".repeat(32)
    private val keyHex = (0 until 32).joinToString("") { "%02x".format(it) }
    private fun keyBytes() = ByteArray(32) { it.toByte() }
    private fun dir(): File = Files.createTempDirectory("module-keys").toFile()
    private fun code(block: () -> Unit): String = try { block(); fail("expected an error"); "" } catch (e: ConstructError) { e.code }

    @Test fun storesWrappedAndReturnsTheExactBinding() {
        val d = dir()
        val keys = ModuleKeys(d, FakeWrapper(), publisher)
        keys.add(id, keyId, keyBytes(), "table")
        assertArrayEquals(keyBytes(), keys.key(id, keyId))
        assertEquals(listOf(ModuleKeyRecord(publisher, id, keyId, "table")), keys.list())
        // The raw key never reaches the file, in hex or base64.
        val text = File(d, "module-keys.json").readText()
        assertFalse(text.contains(keyHex))
        assertFalse(text.contains(java.util.Base64.getEncoder().encodeToString(keyBytes())))
        // Other key IDs, other modules and another trusted publisher find nothing.
        assertNull(keys.key(id, "3".repeat(32)))
        assertNull(keys.key("sealed.a" + "4".repeat(32), keyId))
        assertNull(ModuleKeys(d, FakeWrapper(), "cd".repeat(32)).key(id, keyId))
    }

    @Test fun addClearsTheCallersKey() {
        val k = keyBytes()
        ModuleKeys(dir(), FakeWrapper(), publisher).add(id, keyId, k)
        assertTrue(k.all { it == 0.toByte() })
    }

    @Test fun aRecordMovedToAnotherBindingDoesNotUnwrap() {
        val d = dir()
        val keys = ModuleKeys(d, FakeWrapper(), publisher)
        keys.add(id, keyId, keyBytes())
        val f = File(d, "module-keys.json")
        val other = "sealed.a" + "5".repeat(32)
        f.writeText(f.readText().replace(id, other))
        assertEquals("KEY_UNAVAILABLE", code { keys.key(other, keyId) })
        // A lost wrapping key (Keystore reset) is the same answer, never a wrong key.
        f.writeText(f.readText().replace(other, id))
        assertEquals("KEY_UNAVAILABLE", code { ModuleKeys(d, FakeWrapper(ByteArray(32) { 9 }), publisher).key(id, keyId) })
    }

    @Test fun parseAcceptsGroupedHexAndRejectsEverythingElse() {
        val keys = ModuleKeys(dir(), FakeWrapper(), publisher)
        val grouped = keyHex.uppercase().chunked(8).joinToString(" ").chunked(36).joinToString("\n")
        val (pid, pkid, pkey) = keys.parse(" $id ", keyId.uppercase(), grouped)
        assertEquals(id, pid); assertEquals(keyId, pkid); assertArrayEquals(keyBytes(), pkey)
        for ((badId, badKeyId, badKey) in listOf(
            Triple("dev.example.plain", keyId, keyHex),
            Triple(id, keyId.dropLast(1), keyHex),
            Triple(id, keyId, keyHex.dropLast(2)),
            Triple(id, keyId, keyHex + "00"),
            Triple(id, keyId, keyHex.replaceRange(0, 1, "g")),
            Triple(id, keyId, keyHex + " ".repeat(2000)),
        )) {
            try { keys.parse(badId, badKeyId, badKey); fail("accepted $badId $badKeyId") } catch (e: ConstructError) {
                assertEquals("KEY_FORMAT", e.code)
                assertFalse(e.message!!.contains(keyHex.take(16)))
            }
        }
        assertEquals("KEY_FORMAT", code { keys.add("dev.example.plain", keyId, keyBytes()) })
    }

    private fun recordLine(publisher: String = this.publisher, format: String = "construct-key-v1", extra: String = "") =
        """{"format":"$format","publisher":"$publisher","id":"$id","keyId":"$keyId","key":"$keyHex"$extra}"""

    @Test fun aWholeKeyRecordIsTakenInOnePaste() {
        val keys = ModuleKeys(dir(), FakeWrapper(), publisher)
        // Exactly the line encrypt_module.py key-record prints (key_record_line), with stray whitespace from a paste.
        val (pid, pkid, pkey) = keys.parseRecord("  " + recordLine() + "\n")
        assertEquals(id, pid); assertEquals(keyId, pkid); assertArrayEquals(keyBytes(), pkey)
        assertEquals("KEY_PUBLISHER", code { keys.parseRecord(recordLine(publisher = "cd".repeat(32))) })
        for (bad in listOf(recordLine(format = "construct-key-v2"), recordLine(extra = ",\"x\":\"y\""), recordLine(extra = ",\"key\":\"$keyHex\""),
                recordLine().replace("\"keyId\":\"$keyId\",", ""), recordLine().dropLast(1), "$keyHex", "")) {
            try { keys.parseRecord(bad); fail("accepted $bad") } catch (e: ConstructError) {
                assertEquals(bad, "KEY_FORMAT", e.code)
                assertFalse(e.message!!.contains(keyHex.take(16)))
            }
        }
    }

    @Test fun refusesDuplicatesAndTheHundredFirstRecord() {
        val keys = ModuleKeys(dir(), FakeWrapper(), publisher)
        keys.add(id, keyId, keyBytes())
        assertEquals("KEY_EXISTS", code { keys.add(id, keyId, keyBytes()) })
        for (i in 1 until ModuleKeys.MAX_RECORDS) keys.add("sealed.a" + "%032x".format(i + 1000), keyId, keyBytes())
        assertEquals(ModuleKeys.MAX_RECORDS, keys.list().size)
        assertEquals("KEY_LIMIT", code { keys.add("sealed.a" + "f".repeat(32), keyId, keyBytes()) })
    }

    @Test fun forgetRemovesOnlyThatKey() {
        val d = dir()
        val keys = ModuleKeys(d, FakeWrapper(), publisher)
        val second = "sealed.a" + "6".repeat(32)
        keys.add(id, keyId, keyBytes()); keys.add(second, keyId, keyBytes())
        assertTrue(keys.forget(id, keyId))
        assertFalse(keys.forget(id, keyId))
        assertNull(keys.key(id, keyId))
        assertArrayEquals(keyBytes(), keys.key(second, keyId))
        assertEquals(1, JSONArray(File(d, "module-keys.json").readText()).length())
    }

    @Test fun anotherPublishersRecordsAreNotListedOrUsed() {
        val d = dir()
        ModuleKeys(d, FakeWrapper(), "cd".repeat(32)).add(id, keyId, keyBytes())
        val keys = ModuleKeys(d, FakeWrapper(), publisher)
        assertTrue(keys.list().isEmpty())
        assertFalse(keys.forget(id, keyId))
        keys.add(id, keyId, keyBytes())
        assertEquals(1, keys.list().size)
        assertEquals(2, JSONArray(File(d, "module-keys.json").readText()).length())
    }

    @Test fun aRecordThatNoLongerUnwrapsIsReplacedByAReimport() {
        val d = dir()
        ModuleKeys(d, FakeWrapper(), publisher).add(id, keyId, keyBytes())
        val afterReset = ModuleKeys(d, FakeWrapper(ByteArray(32) { 9 }), publisher)
        assertEquals("KEY_UNAVAILABLE", code { afterReset.key(id, keyId) })
        afterReset.add(id, keyId, keyBytes())
        assertArrayEquals(keyBytes(), afterReset.key(id, keyId))
        assertEquals(1, afterReset.list().size)
        assertEquals("KEY_EXISTS", code { afterReset.add(id, keyId, keyBytes()) })
    }

    @Test fun anUnreadableStoreIsAnErrorNotAnEmptyList() {
        val d = dir()
        File(d, "module-keys.json").writeText("{not json")
        assertEquals("KEY_STORE_INVALID", code { ModuleKeys(d, FakeWrapper(), publisher).list() })
    }
}
