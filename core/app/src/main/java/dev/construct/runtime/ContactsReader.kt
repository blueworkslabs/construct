package dev.construct.runtime

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.provider.ContactsContract
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Read-only provider adapter. No caller SQL/URI/projection, persistent cache, or data logging. */
internal class ContactsReader(private val context: Context, private val authorize: () -> Unit) {
    companion object {
        // One provider worker plus one queued task for the entire process, not per WebView.
        private val executor = ThreadPoolExecutor(1, 1, 30, TimeUnit.SECONDS, ArrayBlockingQueue(1)).apply { allowCoreThreadTimeOut(true) }
        fun hasPermission(context: Context) = context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
    }
    private val handler = Handler(Looper.getMainLooper())
    private val closed = AtomicBoolean(false)
    private val busy = AtomicBoolean(false)
    private var signal: CancellationSignal? = null
    private var timer: Runnable? = null
    private var lastStart = -500L
    // Worker-confined, ephemeral references. No raw Android IDs cross the bridge.
    private val contacts = mutableMapOf<String, Long>()
    private data class Page(val query: String, val key: String?, val id: Long)
    private val cursors = mutableMapOf<String, Page>()
    private var pages = 0

    fun request(params: JSONObject, complete: (Any?, ConstructError?) -> Unit) {
        checkAccess()
        validate(params)
        val now = android.os.SystemClock.elapsedRealtime()
        checkRule(now - lastStart >= 300, "RATE_LIMIT", "Wait briefly before another contacts request")
        checkRule(busy.compareAndSet(false, true), "CONTACTS_BUSY", "A previous contacts request is still finishing. Wait, or close and reopen to retry")
        lastStart = now
        val cancel = CancellationSignal(); signal = cancel
        val answered = AtomicBoolean(false)
        fun finish(value: Any?, error: ConstructError?) {
            if (!closed.get() && answered.compareAndSet(false, true)) {
                try { checkAccess(); complete(value, error) }
                catch (denied: ConstructError) { complete(null, denied) }
            }
        }
        val timeout = Runnable { cancel.cancel(); finish(null, ConstructError("CONTACTS_TIMEOUT", "Contacts took too long. Close and reopen to retry; if it persists, try later")) }
        timer = timeout; handler.postDelayed(timeout, 4000)
        try {
            executor.execute {
                var value: Any? = null; var error: ConstructError? = null
                try { checkAccess(); cancel.throwIfCanceled(); value = read(params, cancel); checkAccess(); cancel.throwIfCanceled() }
                catch (e: Exception) { error = when (e) {
                    is ConstructError -> e
                    is SecurityException -> ConstructError("ANDROID_PERMISSION_DENIED", "Allow Android contacts access in Module access")
                    is android.os.OperationCanceledException -> ConstructError("CONTACTS_TIMEOUT", "Contacts request was canceled; retry")
                    else -> ConstructError("CONTACTS_UNAVAILABLE", "Contacts are unavailable; retry")
                } }
                handler.post { handler.removeCallbacks(timeout); busy.set(false); finish(value, error) }
            }
        } catch (e: java.util.concurrent.RejectedExecutionException) {
            handler.removeCallbacks(timeout); busy.set(false)
            throw ConstructError("CONTACTS_BUSY", "Contacts provider is still busy. Wait, or close and reopen to retry")
        }
    }
    private fun checkAccess() {
        checkRule(!closed.get(), "RUN_STALE", "Module is closed")
        authorize()
        checkRule(hasPermission(context), "ANDROID_PERMISSION_DENIED", "Allow Android contacts access in Module access")
    }
    internal fun validate(p: JSONObject) {
        val fields = p.keys().asSequence().toSet()
        when (p.opt("op")) {
            "search" -> {
                checkRule(fields == setOf("op", "query") || fields == setOf("op", "query", "cursor"), "INVALID_PARAMS", "Use search with query and optional cursor")
                checkRule(p.opt("query") is String && p.getString("query").length <= 80, "INVALID_PARAMS", "Search is limited to 80 characters")
                if (p.has("cursor")) checkRule(p.opt("cursor") is String && p.getString("cursor").length in 1..36, "INVALID_PARAMS", "Invalid page reference")
            }
            "get" -> checkRule(fields == setOf("op", "ref") && p.opt("ref") is String && p.getString("ref").length in 1..36, "INVALID_PARAMS", "Choose a contact from the current results")
            else -> throw ConstructError("INVALID_PARAMS", "Only search and get are supported")
        }
    }
    internal fun read(p: JSONObject, cancel: CancellationSignal): JSONObject {
        validate(p)
        return if (p.getString("op") == "search") search(p, cancel) else detail(p.getString("ref"), cancel)
    }
    private fun search(p: JSONObject, cancel: CancellationSignal): JSONObject {
        val query = p.getString("query").trim()
        var after: Page? = null
        if (p.has("cursor")) {
            after = cursors.remove(p.getString("cursor"))
            checkRule(after != null && after.query == query, "CONTACTS_STALE", "Search again; page references belong to the current search")
        } else { contacts.clear(); cursors.clear(); pages = 0 }
        checkRule(pages < 10, "CONTACTS_LIMIT", "Narrow your search; at most 200 contacts per search")
        val key = ContactsContract.Contacts.SORT_KEY_PRIMARY
        val id = ContactsContract.Contacts._ID
        // The comparison and ordering use the SAME SQLite collation. IDs break equal-key ties.
        // Null keys sort first; preserve that ordering without dropping unnamed contacts.
        val selection = when {
            after == null -> null
            after.key == null -> "(($key IS NULL AND $id > ?) OR $key IS NOT NULL)"
            else -> "($key COLLATE LOCALIZED > ? OR ($key COLLATE LOCALIZED = ? AND $id > ?))"
        }
        val args = when {
            after == null -> null
            after.key == null -> arrayOf(after.id.toString())
            else -> arrayOf(after.key, after.key, after.id.toString())
        }
        // Only the local/default directory. appendPath encodes query as one segment, never SQL.
        val uri = (if (query.isEmpty()) ContactsContract.Contacts.CONTENT_URI.buildUpon()
            else ContactsContract.Contacts.CONTENT_FILTER_URI.buildUpon().appendPath(query))
            .appendQueryParameter(ContactsContract.DIRECTORY_PARAM_KEY, "0")
            .appendQueryParameter("limit", "21").build()
        val rows = JSONArray(); var more = false; var last = 0L; var lastKey: String? = null
        // AOSP rewrites a bare leading sort_key by copying the entire suffix onto
        // a phonebook bucket. Parenthesize the fixed column to keep ID AFTER name.
        context.contentResolver.query(uri,
            arrayOf(id, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY, key), selection, args,
            "($key) COLLATE LOCALIZED ASC, $id ASC", cancel)?.use { cursor ->
            while (cursor.moveToNext()) {
                cancel.throwIfCanceled()
                if (rows.length() == 20) { more = true; break }
                last = cursor.getLong(0)
                lastKey = cursor.getString(2)
                checkRule(lastKey == null || lastKey!!.length <= 4096, "CONTACTS_UNAVAILABLE", "Contact sorting data is too large")
                val ref = UUID.randomUUID().toString(); contacts[ref] = last
                rows.put(JSONObject().put("ref", ref).put("name", cursor.getString(1)?.take(200) ?: "Unnamed contact"))
            }
        } ?: throw ConstructError("CONTACTS_UNAVAILABLE", "Contacts provider is unavailable")
        pages++
        val next = if (more && pages < 10) UUID.randomUUID().toString().also { cursors[it] = Page(query, lastKey, last) } else null
        return JSONObject().put("items", rows).put("next", next ?: JSONObject.NULL).put("limited", more && next == null)
    }
    private fun detail(ref: String, cancel: CancellationSignal): JSONObject {
        val id = contacts[ref] ?: throw ConstructError("CONTACTS_STALE", "Choose a contact from the current search")
        val name = context.contentResolver.query(ContactsContract.Contacts.CONTENT_URI, arrayOf(ContactsContract.Contacts.DISPLAY_NAME_PRIMARY), "${ContactsContract.Contacts._ID} = ?", arrayOf(id.toString()), null, cancel)?.use {
            if (it.moveToFirst()) it.getString(0)?.take(200) ?: "Unnamed contact" else null
        } ?: throw ConstructError("CONTACTS_NOT_FOUND", "Contact no longer exists; search again")
        val phone = ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE
        val email = ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE
        val phones = JSONArray(); val emails = JSONArray(); val phoneLabels = JSONArray(); val emailLabels = JSONArray(); var limited = false; var seen = 0
        context.contentResolver.query(ContactsContract.Data.CONTENT_URI.buildUpon().appendQueryParameter("limit", "21").build(),
            arrayOf(ContactsContract.Data.MIMETYPE, ContactsContract.Data.DATA1, ContactsContract.Data.DATA2, ContactsContract.Data.DATA3), "${ContactsContract.Data.CONTACT_ID} = ? AND ${ContactsContract.Data.MIMETYPE} IN (?, ?)", arrayOf(id.toString(), phone, email), "${ContactsContract.Data._ID} ASC", cancel)?.use { cursor ->
            while (cursor.moveToNext()) {
                cancel.throwIfCanceled()
                if (++seen > 20) { limited = true; break }
                val isPhone = cursor.getString(0) == phone
                val values = if (isPhone) phones else emails
                val labels = if (isPhone) phoneLabels else emailLabels
                if (values.length() < 5) {
                    values.put((cursor.getString(1) ?: "").take(200))
                    val type = cursor.getInt(2); val custom = cursor.getString(3)?.take(80)
                    val label = if (isPhone) ContactsContract.CommonDataKinds.Phone.getTypeLabel(context.resources, type, custom)
                        else ContactsContract.CommonDataKinds.Email.getTypeLabel(context.resources, type, custom)
                    labels.put(label.toString().take(80))
                } else limited = true
            }
        } ?: throw ConstructError("CONTACTS_UNAVAILABLE", "Contact details are unavailable")
        return JSONObject().put("name", name).put("phones", phones).put("emails", emails).put("phoneLabels", phoneLabels).put("emailLabels", emailLabels).put("limited", limited)
    }
    fun close() { closed.set(true); signal?.cancel(); timer?.let { handler.removeCallbacks(it) } }
}
