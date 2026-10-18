package dev.construct.runtime

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** One imported content key, as listed in Settings: opaque references and a local label only. */
data class ModuleKeyRecord(val publisher: String, val id: String, val keyId: String, val label: String)

/** Wraps content keys at rest. The app's implementation uses an Android Keystore AES-GCM key. */
interface KeyWrapper {
    /** Returns (nonce, ciphertext+tag) for [plain] bound to [aad]. A fresh nonce every call. */
    fun wrap(plain: ByteArray, aad: ByteArray): Pair<ByteArray, ByteArray>
    /** The plaintext, or a [ConstructError] `KEY_UNAVAILABLE` if the wrapping key is gone or the record was altered. */
    fun unwrap(nonce: ByteArray, sealed: ByteArray, aad: ByteArray): ByteArray
}

/** AES-256-GCM under an app-owned, non-exportable Android Keystore key. */
class AndroidKeystoreWrapper(private val alias: String = "construct-module-keys") : KeyWrapper {
    private fun key(create: Boolean): SecretKey? {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        if (!create) return null
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    override fun wrap(plain: ByteArray, aad: ByteArray): Pair<ByteArray, ByteArray> {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
        cipher.updateAAD(aad)
        val sealed = cipher.doFinal(plain)
        return cipher.iv to sealed
    }
    override fun unwrap(nonce: ByteArray, sealed: ByteArray, aad: ByteArray): ByteArray = try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(create = false) ?: throw ConstructError("KEY_UNAVAILABLE", "Unlock the device or re-import the key"),
            GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad)
        cipher.doFinal(sealed)
    } catch (e: ConstructError) { throw e } catch (_: Exception) {
        throw ConstructError("KEY_UNAVAILABLE", "Unlock the device or re-import the key")
    }
}

/**
 * Content keys for `construct-encrypted-v1` packages (docs/encrypted-packages.md, "Native key UX
 * and storage"). Records live in app-private no-backup storage, each key wrapped by [wrapper]
 * with (publisher, module ID, key ID) as associated data, so a record moved to another binding
 * does not unwrap. Raw keys never reach preferences, module storage, the bridge or logs, and
 * there is no export. A lookup is for one exact (publisher, ID, key ID); nothing tries every key.
 */
class ModuleKeys(directory: File, private val wrapper: KeyWrapper, val publisher: String) {
    companion object {
        const val MAX_RECORDS = 100
        const val MAX_IMPORT = 1024
        private val hex32 = Regex("[0-9a-f]{32}")
        private val hex64 = Regex("[0-9a-f]{64}")
    }
    private val file = AtomicFile(File(directory, "module-keys.json"))

    private fun read(): JSONArray {
        val bytes = try { file.readFully() } catch (_: java.io.FileNotFoundException) { return JSONArray() }
        return try { JSONArray(bytes.toString(Charsets.UTF_8)) } catch (_: org.json.JSONException) {
            throw ConstructError("KEY_STORE_INVALID", "Stored keys could not be read")
        }
    }
    private fun write(records: JSONArray) {
        val out = file.startWrite()
        try { out.write(records.toString().toByteArray()); file.finishWrite(out) } catch (e: Exception) { file.failWrite(out); throw e }
    }
    private fun aad(publisher: String, id: String, keyId: String) = "construct-key-v1\u0000$publisher\u0000$id\u0000$keyId".toByteArray()

    /**
     * Validates one manual import: the opaque module ID, the key ID and the 64-hex key (spaces
     * and line breaks between groups allowed). Errors never echo the key.
     */
    fun parse(id: String, keyId: String, keyText: String): Triple<String, String, ByteArray> {
        checkRule(id.length + keyId.length + keyText.length <= MAX_IMPORT, "KEY_FORMAT", "Check the key format")
        val cleanId = id.trim(); val cleanKeyId = keyId.trim().lowercase()
        val hex = keyText.filterNot { it.isWhitespace() }.lowercase()
        checkRule(EncryptedPackages.opaqueId.matches(cleanId) && hex32.matches(cleanKeyId) && hex64.matches(hex), "KEY_FORMAT", "Check the key format")
        return Triple(cleanId, cleanKeyId, ByteArray(32) { hex.substring(2 * it, 2 * it + 2).toInt(16).toByte() })
    }

    private fun mine(r: JSONObject, id: String, keyId: String) =
        r.getString("publisher") == publisher && r.getString("id") == id && r.getString("keyId") == keyId

    /** This publisher's records; another trust anchor's records are neither listed nor used. */
    @Synchronized fun list(): List<ModuleKeyRecord> {
        val records = read()
        return (0 until records.length()).map { records.getJSONObject(it) }.filter { it.getString("publisher") == publisher }.map {
            ModuleKeyRecord(it.getString("publisher"), it.getString("id"), it.getString("keyId"), it.optString("label"))
        }
    }

    /**
     * Stores a key for the trusted publisher. A working record for the same (ID, key ID) is
     * refused (forget it first); one that no longer unwraps (Keystore loss) is replaced, which is
     * the private re-import the design note asks for.
     */
    @Synchronized fun add(id: String, keyId: String, key: ByteArray, label: String = "") {
        try {
            checkRule(EncryptedPackages.opaqueId.matches(id) && hex32.matches(keyId) && key.size == 32, "KEY_FORMAT", "Check the key format")
            var records = read()
            if ((0 until records.length()).any { mine(records.getJSONObject(it), id, keyId) }) {
                val usable = try { key(id, keyId)?.also { it.fill(0) } != null } catch (e: ConstructError) { if (e.code != "KEY_UNAVAILABLE") throw e; false }
                checkRule(!usable, "KEY_EXISTS", "This key is already stored")
                forget(id, keyId)
                records = read()
            }
            checkRule(records.length() < MAX_RECORDS, "KEY_LIMIT", "Forget a key before adding another")
            val (nonce, sealed) = wrapper.wrap(key, aad(publisher, id, keyId))
            val enc = Base64.getEncoder()
            records.put(JSONObject().put("publisher", publisher).put("id", id).put("keyId", keyId)
                .put("label", label.take(40)).put("nonce", enc.encodeToString(nonce)).put("wrapped", enc.encodeToString(sealed)))
            write(records)
        } finally { key.fill(0) }
    }

    /** The key for exactly this binding, or null. A fresh copy; callers clear it after use. */
    @Synchronized fun key(id: String, keyId: String): ByteArray? {
        val records = read()
        for (i in 0 until records.length()) {
            val r = records.getJSONObject(i)
            if (!mine(r, id, keyId)) continue
            val dec = Base64.getDecoder()
            return wrapper.unwrap(dec.decode(r.getString("nonce")), dec.decode(r.getString("wrapped")), aad(publisher, id, keyId))
        }
        return null
    }

    /** Removes the wrapped key. Making the dependent versions non-runnable is the store's job ([ModuleStore]). */
    @Synchronized fun forget(id: String, keyId: String): Boolean {
        val records = read()
        val kept = JSONArray()
        var removed = false
        for (i in 0 until records.length()) {
            val r = records.getJSONObject(i)
            if (mine(r, id, keyId)) removed = true else kept.put(r)
        }
        if (removed) write(kept)
        return removed
    }
}
