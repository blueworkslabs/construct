package dev.construct.runtime

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class GalleryExportTest {
    private class Destination(val failWrite: Boolean = false, val failPublish: Boolean = false,
                              val failCleanup: Boolean = false) : GalleryDestination {
        var published = false
        var discarded = false
        var closed = false
        val bytes = ByteArrayOutputStream()
        override fun open() = object : java.io.OutputStream() {
            override fun write(b: Int) {
                if (failWrite) throw IOException("synthetic full disk")
                bytes.write(b)
            }
            override fun close() { closed = true }
        }
        override fun publish() {
            assertTrue("Stream must close before publication", closed)
            if (failPublish) throw IOException("synthetic provider failure")
            published = true
        }
        override fun discard() {
            if (failCleanup) throw IOException("synthetic cleanup failure")
            discarded = true
        }
    }
    private val source = byteArrayOf(1, 2, 3, 4)
    @Test fun exactCopyClosesBeforeAuthorizationAndDoesNotDeleteSource() {
        val destination = Destination()
        var authorized = false
        GalleryExport.copy(ByteArrayInputStream(source), 4, destination) { publish ->
            assertTrue(destination.closed)
            assertFalse(destination.published)
            authorized = true
            publish()
        }
        assertTrue(authorized); assertTrue(destination.published); assertFalse(destination.discarded)
        assertArrayEquals(source, destination.bytes.toByteArray())
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), source)
    }
    @Test fun revokedOrClosedBeforePublicationDiscardsCompletePendingCopy() {
        for (code in listOf("CAPABILITY_DENIED", "ANDROID_PERMISSION_DENIED", "CAMERA_CLOSED")) {
            val destination = Destination()
            try {
                GalleryExport.copy(ByteArrayInputStream(source), 4, destination) { throw ConstructError(code, "synthetic denial") }
                fail("Expected denial")
            } catch (e: ConstructError) { assertEquals(code, e.code) }
            assertTrue(destination.closed); assertTrue(destination.discarded); assertFalse(destination.published)
        }
    }
    @Test fun partialWritesOrPublishFailuresDiscardPendingRows() {
        for (destination in listOf(Destination(failWrite = true), Destination(failPublish = true))) {
            try {
                GalleryExport.copy(ByteArrayInputStream(source), 4, destination) { it() }
                fail("Expected failure")
            } catch (_: IOException) { }
            assertTrue(destination.closed); assertTrue(destination.discarded); assertFalse(destination.published)
        }
    }
    @Test fun invalidLengthsNeverPublishAndAlwaysDiscard() {
        for (size in listOf(0L, 3L, 5L, CameraPhotos.MAX_FILE + 1)) {
            val destination = Destination()
            try {
                GalleryExport.copy(ByteArrayInputStream(source), size, destination) { fail("Invalid copy reached publication") }
                fail("Expected invalid size")
            } catch (e: ConstructError) { assertEquals("PHOTO_EXPORT", e.code) }
            assertFalse(destination.published); assertTrue(destination.discarded)
        }
    }
    @Test fun cleanupFailureIsNotReportedAsSuccessfulCancellation() {
        val destination = Destination(failWrite = true, failCleanup = true)
        try {
            GalleryExport.copy(ByteArrayInputStream(source), 4, destination) { it() }
            fail("Expected cleanup failure")
        } catch (e: ConstructError) { assertEquals("PHOTO_EXPORT_CLEANUP", e.code) }
        assertFalse(destination.published)
    }
}
