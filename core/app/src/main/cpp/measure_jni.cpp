#include <jni.h>
#include <opencv2/core.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/objdetect/aruco_detector.hpp>
#include <vector>
#include <stdexcept>

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_dev_construct_runtime_ImageMarkerNative_detect(JNIEnv* env, jobject, jintArray pixels,
                                               jint width, jint height) {
    // Independent native bounds: this entry point cannot process an arbitrary allocation.
    if (!pixels || width < 1 || height < 1 || width > 1600 || height > 1600 ||
        env->GetArrayLength(pixels) != width * height) {
        env->ThrowNew(env->FindClass("java/lang/IllegalArgumentException"), "Invalid image");
        return nullptr;
    }
    try {
        // Bitmap.getPixels returns packed ARGB. Extract channels explicitly, independent
        // of byte order and bitmap backing format; same RGBA -> gray conversion as v0.
        std::vector<jint> packed(width * height);
        env->GetIntArrayRegion(pixels, 0, width * height, packed.data());
        if (env->ExceptionCheck()) return nullptr;
        cv::Mat rgba(height, width, CV_8UC4);
        for (int y = 0; y < height; ++y) {
            auto* row = rgba.ptr<cv::Vec4b>(y);
            for (int x = 0; x < width; ++x) {
                const auto value = static_cast<unsigned int>(packed[y * width + x]);
                row[x] = cv::Vec4b((value >> 16) & 255, (value >> 8) & 255,
                                  value & 255, (value >> 24) & 255);
            }
        }
        cv::Mat gray;
        cv::cvtColor(rgba, gray, cv::COLOR_RGBA2GRAY);
        cv::aruco::DetectorParameters parameters;
        parameters.cornerRefinementMethod = cv::aruco::CORNER_REFINE_SUBPIX;
        cv::aruco::ArucoDetector detector(
            cv::aruco::getPredefinedDictionary(cv::aruco::DICT_4X4_50), parameters);
        std::vector<std::vector<cv::Point2f>> corners;
        std::vector<int> ids;
        detector.detectMarkers(gray, corners, ids);
        std::vector<jdouble> result;
        if (ids.size() > 64) throw std::runtime_error("Too many markers");
        for (size_t i = 0; i < ids.size(); ++i) {
            result.push_back(ids[i]);
            for (const auto& point : corners[i]) {
                result.push_back(point.x / static_cast<double>(width));
                result.push_back(point.y / static_cast<double>(height));
            }
        }
        auto output = env->NewDoubleArray(static_cast<jsize>(result.size()));
        if (output && !result.empty())
            env->SetDoubleArrayRegion(output, 0, static_cast<jsize>(result.size()), result.data());
        return output;
    } catch (...) {
        // No image values or arbitrary upstream diagnostics cross the JNI error boundary.
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "Marker detection failed");
        return nullptr;
    }
}
