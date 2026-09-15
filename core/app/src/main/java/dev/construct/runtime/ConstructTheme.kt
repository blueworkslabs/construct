package dev.construct.runtime

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Shared visual tokens. Single source with docs/ux-refresh/design-tokens.md; the module CSS
 * copies carry the same values. Display only: no IO, state or navigation lives here.
 */
internal object ConstructColors {
    val bg = Color(0xFF0B1410)
    val surface = Color(0xFF122019)
    val surface2 = Color(0xFF18291F)
    val border = Color(0xFF2E4638)          // decorative hairlines only (1.6:1)
    val controlBorder = Color(0xFF6F8C7C)   // interactive boundaries (4.6:1 on surface)
    val text = Color(0xFFE6F0EA)
    val muted = Color(0xFF9DB3A6)
    val jade = Color(0xFF5FD3A0)
    val jadeInk = Color(0xFF06110B)
    val focus = Color(0xFF8CF0C4)
    val amber = Color(0xFFE9C46A)
    val error = Color(0xFFF08A7E)
    val disabled = Color(0xFF5E7268)

    fun tone(tone: WorkshopTone): Color = when (tone) {
        WorkshopTone.NEUTRAL -> muted
        WorkshopTone.ATTENTION -> amber
        WorkshopTone.ERROR -> error
    }
}

/** Every container/on-container pair is explicit so no default Material purple survives. */
internal val ConstructColorScheme = darkColorScheme(
    primary = ConstructColors.jade,
    onPrimary = ConstructColors.jadeInk,
    primaryContainer = ConstructColors.jade,
    onPrimaryContainer = ConstructColors.jadeInk,
    inversePrimary = ConstructColors.jadeInk,
    secondary = ConstructColors.jade,
    onSecondary = ConstructColors.jadeInk,
    secondaryContainer = ConstructColors.surface2,
    onSecondaryContainer = ConstructColors.text,
    tertiary = ConstructColors.amber,
    onTertiary = ConstructColors.jadeInk,
    tertiaryContainer = ConstructColors.surface2,
    onTertiaryContainer = ConstructColors.amber,
    background = ConstructColors.bg,
    onBackground = ConstructColors.text,
    surface = ConstructColors.surface,
    onSurface = ConstructColors.text,
    surfaceVariant = ConstructColors.surface2,
    onSurfaceVariant = ConstructColors.muted,
    surfaceTint = ConstructColors.jade,
    inverseSurface = ConstructColors.text,
    inverseOnSurface = ConstructColors.bg,
    error = ConstructColors.error,
    onError = ConstructColors.jadeInk,
    errorContainer = ConstructColors.surface2,
    onErrorContainer = ConstructColors.error,
    outline = ConstructColors.controlBorder,
    outlineVariant = ConstructColors.border,
    scrim = Color.Black,
    surfaceBright = ConstructColors.surface2,
    surfaceDim = ConstructColors.bg,
    surfaceContainer = ConstructColors.surface,
    surfaceContainerHigh = ConstructColors.surface2,
    surfaceContainerHighest = ConstructColors.surface2,
    surfaceContainerLow = ConstructColors.surface,
    surfaceContainerLowest = ConstructColors.bg,
)

/** System font throughout; monospace reserved for versions, values and technical details. */
internal val ConstructTypography = Typography(
    headlineSmall = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    labelMedium = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
)

internal val ConstructMono = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 18.sp)

@Composable
internal fun ConstructTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ConstructColorScheme, typography = ConstructTypography, content = content)
}
