package dev.construct.runtime

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.CancellationSignal
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.LooperMode
import android.provider.ContactsContract
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@LooperMode(LooperMode.Mode.PAUSED)
class ContactsReaderTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var provider: FakeProvider
    private lateinit var reader: ContactsReader
    private fun expect(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch(e: ConstructError) { assertEquals(code, e.code) }
    }
    class FakeProvider : ContentProvider() {
        var lastArgs: Array<out String>? = null
        var calls = 0
        var lastUri: Uri? = null
        var lastSelection: String? = null
        var lastOrder: String? = null
        var nullKeys = false
        var sameKeys = false
        var entered: CountDownLatch? = null
        var release: CountDownLatch? = null
        override fun onCreate() = true
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, order: String?): Cursor {
            calls++; lastArgs=args; lastUri=uri; lastSelection=selection; lastOrder=order
            entered?.countDown(); release?.await(5,TimeUnit.SECONDS)
            val result=MatrixCursor(projection!!)
            if (uri.path == "/data") repeat(12) { result.addRow(arrayOf<Any?>(if(it<6) ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE else ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE, "x".repeat(500),2,null)) }
            else if (projection.size == 1) result.addRow(arrayOf("Synthetic person"))
            else {
                val after=args?.lastOrNull()?.toLongOrNull() ?: 0L
                for(i in after+1..minOf(after+21,250)) result.addRow(arrayOf<Any?>(i,"Person $i",if(nullKeys)null else if(sameKeys)"Same" else "Person %03d".format(i)))
            }
            return result
        }
        override fun insert(uri: Uri, values: ContentValues?): Uri? = error("No writes")
        override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?): Int = error("No writes")
        override fun delete(uri: Uri, selection: String?, args: Array<out String>?): Int = error("No writes")
        override fun getType(uri: Uri): String? = null
    }
    @Before fun setup() {
        provider=FakeProvider(); ShadowContentResolver.registerProviderInternal(ContactsContract.AUTHORITY,provider)
        reader=ContactsReader(app) {}
    }
    private fun search(query: String = "", cursor: String? = null): JSONObject = reader.read(JSONObject().put("op","search").put("query",query).apply { if(cursor!=null)put("cursor",cursor) },CancellationSignal())
    @Test fun boundedKeysetPagesAndOpaqueReferencesCannotBeReplayedAfterNewSearch() {
        val first=search();assertEquals(20,first.getJSONArray("items").length())
        val item=first.getJSONArray("items").getJSONObject(0)
        assertFalse(item.has("id"));val ref=item.getString("ref");assertEquals(36,ref.length)
        val second=search(cursor=first.getString("next"));assertEquals("Person 21",second.getJSONArray("items").getJSONObject(0).getString("name"))
        expect("CONTACTS_STALE") { search(cursor=first.getString("next")) }
        search("new")
        expect("CONTACTS_STALE") { reader.read(JSONObject().put("op","get").put("ref",ref),CancellationSignal()) }
        expect("CONTACTS_STALE") { search("new",second.getString("next")) }
    }
    @Test fun searchCapAndEncodedLocalProviderFilter() {
        search("%_\\' OR 1=1")
        assertEquals("%_\\' OR 1=1",provider.lastUri!!.lastPathSegment)
        assertEquals("0",provider.lastUri!!.getQueryParameter("directory"))
        assertTrue(provider.lastUri!!.pathSegments.contains("filter"))
        assertNull(provider.lastSelection);assertNull(provider.lastArgs)
        search("a/b?directory=9")
        assertEquals(listOf("contacts","filter","a/b?directory=9"),provider.lastUri!!.pathSegments)
        assertEquals("0",provider.lastUri!!.getQueryParameter("directory"))
        var page=search()
        repeat(9){page=search(cursor=page.getString("next"))}
        assertTrue(page.getBoolean("limited"));assertTrue(page.isNull("next"))
    }
    @Test fun detailFieldsAreBoundedAndUnknownReferencesCannotQueryProvider() {
        val ref=search().getJSONArray("items").getJSONObject(0).getString("ref")
        val detail=reader.read(JSONObject().put("op","get").put("ref",ref),CancellationSignal())
        assertEquals(5,detail.getJSONArray("phones").length());assertEquals(5,detail.getJSONArray("emails").length())
        assertEquals(200,detail.getJSONArray("phones").getString(0).length);assertTrue(detail.getBoolean("limited"))
        assertEquals("Mobile",detail.getJSONArray("phoneLabels").getString(0));assertEquals("Work",detail.getJSONArray("emailLabels").getString(0))
        val before=provider.calls
        expect("CONTACTS_STALE") { reader.read(JSONObject().put("op","get").put("ref","1"),CancellationSignal()) }
        assertEquals(before,provider.calls)
    }
    @Test fun callerCannotSupplyUrisWritesOrExtraParameters() {
        for(p in listOf(JSONObject().put("op","delete"),JSONObject().put("op","search").put("query",7),JSONObject().put("op","search").put("query","a".repeat(81)),JSONObject().put("op","search").put("query","").put("uri","content://other")))
            expect("INVALID_PARAMS") { reader.validate(p) }
        assertEquals(0,provider.calls)
    }
    @Test fun bothPermissionGatesAndClosedLifetimePreventProviderWork() {
        val params=JSONObject().put("op","search").put("query","")
        val deny=ContactsReader(app) { throw ConstructError("CAPABILITY_DENIED","Denied") }
        expect("CAPABILITY_DENIED") { deny.request(params) { _,_-> fail() } }
        expect("ANDROID_PERMISSION_DENIED") { reader.request(params) { _,_-> fail() } }
        reader.close();expect("RUN_STALE") { reader.request(params) { _,_-> fail() } }
        assertEquals(0,provider.calls)
    }
    private fun awaitCompletion() {
        repeat(100) { Thread.sleep(10); shadowOf(Looper.getMainLooper()).idle() }
    }
    @Test fun revocationDuringProviderReadCannotDeliverData() {
        shadowOf(app).grantPermissions(android.Manifest.permission.READ_CONTACTS)
        var allowed=true
        val guarded=ContactsReader(app) { checkRule(allowed,"CAPABILITY_DENIED","Denied") }
        provider.entered=CountDownLatch(1);provider.release=CountDownLatch(1)
        var response:Any?=null;var code:String?=null
        guarded.request(JSONObject().put("op","search").put("query","")) { value,error->response=value;code=error?.code }
        assertTrue(provider.entered!!.await(3,TimeUnit.SECONDS));allowed=false;provider.release!!.countDown()
        awaitCompletion();assertNull(response);assertEquals("CAPABILITY_DENIED",code);guarded.close()
    }
    @Test fun timeoutReturnsOnceAndClosingDropsLateProviderData() {
        shadowOf(app).grantPermissions(android.Manifest.permission.READ_CONTACTS)
        provider.entered=CountDownLatch(1);provider.release=CountDownLatch(1)
        var replies=0;var code:String?=null
        reader.request(JSONObject().put("op","search").put("query","")) { value,error->assertNull(value);replies++;code=error?.code }
        assertTrue(provider.entered!!.await(3,TimeUnit.SECONDS))
        shadowOf(Looper.getMainLooper()).idleFor(4100,TimeUnit.MILLISECONDS)
        assertEquals("CONTACTS_TIMEOUT",code);assertEquals(1,replies)
        reader.close();provider.release!!.countDown();awaitCompletion();assertEquals(1,replies)
    }

    @Test fun duplicateAndNullSortKeysUseBoundedIdTieBreakers() {
        provider.sameKeys=true
        var page=search();search(cursor=page.getString("next"))
        assertArrayEquals(arrayOf("Same","Same","20"),provider.lastArgs)
        assertEquals("(sort_key) COLLATE LOCALIZED ASC, _id ASC",provider.lastOrder)
        assertTrue(provider.lastSelection!!.contains("sort_key COLLATE LOCALIZED = ? AND _id > ?"))
        provider.nullKeys=true
        page=search();search(cursor=page.getString("next"))
        assertArrayEquals(arrayOf("20"),provider.lastArgs)
        assertTrue(provider.lastSelection!!.contains("sort_key IS NULL"))
    }
    @Test fun moduleAndAndroidGatesAreRecheckedOnUiDeliveryAfterRead() {
        for (osGate in listOf(false,true)) {
            provider.calls=0
            shadowOf(app).grantPermissions(android.Manifest.permission.READ_CONTACTS)
            val guarded=ContactsReader(app) {
                if (provider.calls>0 && Looper.myLooper()==Looper.getMainLooper()) {
                    if(osGate)shadowOf(app).denyPermissions(android.Manifest.permission.READ_CONTACTS)
                    else throw ConstructError("CAPABILITY_DENIED","Revoked before delivery")
                }
            }
            var response:Any?=null;var code:String?=null
            guarded.request(JSONObject().put("op","search").put("query","")) {value,error->response=value;code=error?.code}
            awaitCompletion();assertNull(response)
            assertEquals(if(osGate)"ANDROID_PERMISSION_DENIED" else "CAPABILITY_DENIED",code);guarded.close()
        }
    }
    @Test fun timedOutWorkerRemainsBoundedUntilItFinishesThenRetryWorks() {
        shadowOf(app).grantPermissions(android.Manifest.permission.READ_CONTACTS)
        provider.entered=CountDownLatch(1);provider.release=CountDownLatch(1)
        val params=JSONObject().put("op","search").put("query","")
        var replies=0
        reader.request(params){value,error->assertNull(value);assertEquals("CONTACTS_TIMEOUT",error?.code);replies++}
        assertTrue(provider.entered!!.await(3,TimeUnit.SECONDS))
        shadowOf(Looper.getMainLooper()).idleFor(4100,TimeUnit.MILLISECONDS)
        expect("CONTACTS_BUSY"){reader.request(params){_,_->fail("Still-running worker must not be replaced")}}
        assertEquals(1,provider.calls)
        provider.release!!.countDown();awaitCompletion();assertEquals(1,replies)
        reader.request(params){value,error->assertNotNull(value);assertNull(error);replies++}
        awaitCompletion();assertEquals(2,replies);reader.close()
    }

}
