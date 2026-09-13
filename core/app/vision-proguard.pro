# MediaPipe's packaged AAR has JNI callbacks / graph reflection but no consumer
# rules. Keep its Java bindings and generated graph types stable in pilot builds.
# Remote logging classes were already removed from the locally prepared AAR.
-keep class com.google.mediapipe.** { *; }
