# MediaPipe's packaged AAR has JNI callbacks / graph reflection but no consumer
# rules. Keep its Java bindings and generated graph types stable in pilot builds.
# Remote logging classes were already removed from the locally prepared AAR.
-keep class com.google.mediapipe.** { *; }
# FluentLogger.forEnclosingClass discovers the caller by walking its own stack.
# Inlining/merging it causes Graph static initialization to fail on Android.
-keep class com.google.common.flogger.** { *; }
-keepattributes SourceFile,LineNumberTable
# Protobuf Lite's schema reads message fields reflectively. Without this rule
# R8 removed Any.typeUrl_/value_, breaking native task graph serialization.
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite {
    <fields>;
}
# Upstream core exposes optional graph-template/profiler APIs without packaging
# their proto classes. Construct uses neither; retain JNI while allowing only
# these two upstream missing-type warnings (not arbitrary missing dependencies).
-dontwarn com.google.mediapipe.proto.CalculatorProfileProto$CalculatorProfile
-dontwarn com.google.mediapipe.proto.GraphTemplateProto$CalculatorGraphTemplate
