package dev.construct.runtime

/** Shared native/CSS layout dimensions, in dp and device-width CSS px respectively. */
internal object ModuleLayout {
    const val MENU_RECT = 56
    const val MENU_TARGET = 48
    fun cornerAware(api: String) = api in setOf("0.5.0", "0.6.0", "0.7.0", "0.8.0", "0.9.0")
    val css = ":root{--construct-menu-width:${MENU_RECT}px;--construct-menu-height:${MENU_RECT}px;--construct-menu-top:0px;--construct-menu-right:0px;}"
}
