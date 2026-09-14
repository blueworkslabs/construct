cmake_minimum_required(VERSION 3.22.1)
project(construct_measure LANGUAGES C CXX)
set_property(GLOBAL PROPERTY JOB_POOLS construct_compile=1 construct_link=1)
set(CMAKE_JOB_POOL_COMPILE construct_compile)
set(CMAKE_JOB_POOL_LINK construct_link)

get_filename_component(CONSTRUCT_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../../.." ABSOLUTE)
set(OPENCV_SOURCE "${CONSTRUCT_ROOT}/dist/native-source/opencv-4.12.0")
if(NOT EXISTS "${OPENCV_SOURCE}/CMakeLists.txt")
    message(FATAL_ERROR "Run python3 scripts/prepare_opencv.py before building")
endif()

# Keep the proven upstream ArUco detector, but statically link only the code
# reachable from our small JNI bridge. No all-purpose Java wrapper / DNN / IO.
set(BUILD_LIST "objdetect" CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_PERF_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_ANDROID_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_ANDROID_PROJECTS OFF CACHE BOOL "" FORCE)
set(BUILD_JAVA OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_java OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_apps OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_python2 OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_python3 OFF CACHE BOOL "" FORCE)
set(WITH_OPENCL OFF CACHE BOOL "" FORCE)
set(WITH_IPP OFF CACHE BOOL "" FORCE)
set(WITH_ITT OFF CACHE BOOL "" FORCE)
set(WITH_TBB OFF CACHE BOOL "" FORCE)
set(WITH_OPENMP OFF CACHE BOOL "" FORCE)
set(WITH_LAPACK OFF CACHE BOOL "" FORCE)
set(WITH_EIGEN OFF CACHE BOOL "" FORCE)
set(WITH_PROTOBUF OFF CACHE BOOL "" FORCE)
set(WITH_QUIRC OFF CACHE BOOL "" FORCE)
set(WITH_KLEIDICV OFF CACHE BOOL "" FORCE)
set(WITH_CAROTENE OFF CACHE BOOL "" FORCE)
set(WITH_ADE OFF CACHE BOOL "" FORCE)
set(WITH_FLATBUFFERS OFF CACHE BOOL "" FORCE)
set(CPU_DISPATCH "" CACHE STRING "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
add_subdirectory("${OPENCV_SOURCE}" "${CMAKE_CURRENT_BINARY_DIR}/opencv" EXCLUDE_FROM_ALL)

add_library(construct_measure SHARED measure_jni.cpp)
target_compile_features(construct_measure PRIVATE cxx_std_17)
target_compile_options(construct_measure PRIVATE -fvisibility=hidden -ffunction-sections -fdata-sections)
target_include_directories(construct_measure PRIVATE
    "${OPENCV_SOURCE}/modules/core/include"
    "${OPENCV_SOURCE}/modules/imgproc/include"
    "${OPENCV_SOURCE}/modules/objdetect/include"
    "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(construct_measure PRIVATE opencv_objdetect opencv_imgproc opencv_core)
target_link_options(construct_measure PRIVATE
    "-Wl,--gc-sections" "-Wl,--exclude-libs,ALL" "-Wl,-z,max-page-size=16384")
