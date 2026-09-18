package dev.construct.runtime

import java.io.File
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class PhotoGrantUpgradeTest {
    private val app get()=RuntimeEnvironment.getApplication()
    private lateinit var store:ModuleStore
    @Before fun setup(){app.filesDir.listFiles()?.forEach{it.deleteRecursively()};store=ModuleStore(app)}
    private fun fixture(folder:String):VerifiedPackage{
        val dir=File(System.getProperty("construct.fixtureRoot"),folder)
        val entry=Packages.catalog(File(dir,"index.json").readBytes()).filter{it.id=="dev.construct.camera"}.maxBy{it.version}
        return Packages.verify(File(dir,entry.artifact).readBytes(),entry,store.publicKey)
    }
    @Test fun installingPrivatePhotoModuleDoesNotInheritNativeCameraGrantOrDeleteStoredFiles(){
        val old=fixture("camera-registry");val modern=fixture("home-registry")
        store.install(old,mapOf("camera.capture" to true));store.confirm(old.manifest.id)
        val folder=File(app.filesDir,"camera-photos/${old.manifest.id}").apply{mkdirs()}
        val photo=File(folder,"00000000-0000-4000-8000-000000000001.jpg").apply{writeBytes(byteArrayOf(1,2,3))}
        store.install(modern);store=ModuleStore(app)
        val active=store.installed().single()
        assertArrayEquals(byteArrayOf(1,2,3),photo.readBytes())
        for(cap in listOf("camera.photo","photos.library","image.read","image.analyze")){
            assertFalse(cap in active.granted)
            try{store.withCapability(active,cap){fail("Legacy grant authorized $cap")}}catch(e:ConstructError){assertEquals("CAPABILITY_DENIED",e.code)}
        }
        store.setCapability(active.manifest.id,"image.read",true)
        assertFalse("photos.library" in store.installed().single().granted)
        assertFalse("image.analyze" in store.installed().single().granted)
        assertArrayEquals(byteArrayOf(1,2,3),photo.readBytes())
    }
}
