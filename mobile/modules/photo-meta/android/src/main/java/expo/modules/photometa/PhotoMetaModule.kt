package expo.modules.photometa

import android.location.Address
import android.location.Geocoder
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.exifinterface.media.ExifInterface
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.util.Locale

// 사진에 들어 있는 좌표·촬영 시간대를 읽는다.
// Android Geocoder 자체는 위치 권한이 필요 없다 (기기 위치가 아니라 주어진 좌표를 변환한다).
private const val COMPACT_SHORT_SIDE = 720
private const val COMPACT_BITRATE = 5_000_000

class PhotoMetaModule : Module() {
  private lateinit var trashLauncher: AppContextActivityResultLauncher<TrashContractInput, Boolean>

  override fun definition() = ModuleDefinition {
    Name("PhotoMeta")

    RegisterActivityContracts {
      trashLauncher = registerForActivityResult(TrashContract(this@PhotoMetaModule))
    }

    // 사진·동영상을 기기 휴지통으로 옮긴다 (Android 11+). 사용자가 확인 창에서 취소하면 false.
    AsyncFunction("trashPhotos") Coroutine { photoIds: List<String>, videoIds: List<String> ->
      return@Coroutine trashLauncher.launch(TrashContractInput(photoIds, videoIds))
    }

    // 파일의 MD5(hex). 몇 GB짜리 동영상도 올리므로 조금씩 읽는다.
    AsyncFunction("md5File") { uri: String ->
      val context = appContext.reactContext ?: throw CodedException("React context is not available")
      val digest = MessageDigest.getInstance("MD5")
      val input = context.contentResolver.openInputStream(Uri.parse(uri))
        ?: throw CodedException("Cannot open $uri")
      input.use { stream ->
        val buffer = ByteArray(1024 * 1024)
        while (true) {
          val read = stream.read(buffer)
          if (read < 0) break
          digest.update(buffer, 0, read)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    // 동영상을 짧은 변 720px 이하의 H.264 mp4로 줄인다 (효율 보관). 원래 작으면 키우지 않는다.
    AsyncFunction("transcodeVideo") { inputUri: String, outputUri: String, promise: Promise ->
      val context = appContext.reactContext ?: throw CodedException("React context is not available")
      val outputPath = Uri.parse(outputUri).path ?: throw CodedException("Invalid output uri")
      java.io.File(outputPath).delete()
      val scale = scaleForShortSide(context, Uri.parse(inputUri), COMPACT_SHORT_SIDE)
      // 배율은 회전과 상관없이 같으므로, 세로 영상의 회전 정보를 따로 따지지 않아도 된다.
      val effects = if (scale < 1f) {
        Effects(listOf(), listOf(ScaleAndRotateTransformation.Builder().setScale(scale, scale).build()))
      } else {
        Effects.EMPTY
      }
      val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(inputUri))).setEffects(effects).build()
      // Transformer는 만든 스레드(Looper)에서만 다뤄야 한다.
      Handler(Looper.getMainLooper()).post {
        try {
          val encoders = DefaultEncoderFactory.Builder(context)
            .setRequestedVideoEncoderSettings(
              VideoEncoderSettings.Builder().setBitrate(COMPACT_BITRATE).build()
            )
            .build()
          Transformer.Builder(context)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoders)
            .addListener(object : Transformer.Listener {
              override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                promise.resolve(null)
              }

              override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                java.io.File(outputPath).delete()
                promise.reject(CodedException("Video export failed", exportException))
              }
            })
            .build()
            .start(item, outputPath)
        } catch (e: Exception) {
          promise.reject(CodedException("Video export failed", e))
        }
      }
    }

    // 좌표 → 주소. 결과가 없거나 실패하면 null.
    // Android Geocoder는 시간대를 주지 않으므로 timeZoneOffsetMinutes는 없다. atMs는 iOS와 시그니처를 맞추기 위한 것.
    AsyncFunction("reverseGeocode") { latitude: Double, longitude: Double, localeId: String, _: Double, promise: Promise ->
      val context = appContext.reactContext
      if (context == null || !Geocoder.isPresent()) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val geocoder = Geocoder(context, Locale.forLanguageTag(localeId))
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          geocoder.getFromLocation(latitude, longitude, 1, object : Geocoder.GeocodeListener {
            override fun onGeocode(addresses: MutableList<Address>) {
              promise.resolve(addresses.firstOrNull()?.let(::toMap))
            }

            override fun onError(errorMessage: String?) {
              promise.resolve(null)
            }
          })
        } else {
          // AsyncFunction은 백그라운드 큐에서 돌므로 동기 호출을 써도 된다.
          @Suppress("DEPRECATION")
          val addresses = geocoder.getFromLocation(latitude, longitude, 1)
          promise.resolve(addresses?.firstOrNull()?.let(::toMap))
        }
      } catch (e: Exception) {
        promise.resolve(null)
      }
    }

    // 원본 파일의 EXIF OffsetTimeOriginal("+09:00") → 분 단위 오프셋. 없으면 null.
    Function("readCaptureOffset") { uri: String ->
      val path = Uri.parse(uri).path ?: return@Function null
      try {
        val exif = ExifInterface(path)
        val value = exif.getAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL)
          ?: exif.getAttribute(ExifInterface.TAG_OFFSET_TIME_DIGITIZED)
          ?: exif.getAttribute(ExifInterface.TAG_OFFSET_TIME)
        value?.let(::parseOffset)
      } catch (e: Exception) {
        null
      }
    }
  }

  private fun scaleForShortSide(context: android.content.Context, uri: Uri, shortSide: Int): Float {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(context, uri)
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
      val short = minOf(width, height)
      if (short <= 0) 1f else minOf(1f, shortSide.toFloat() / short)
    } catch (e: Exception) {
      1f
    } finally {
      retriever.release()
    }
  }

  private fun toMap(address: Address): Map<String, Any?> = mapOf(
    // featureName은 Android에서 번지수인 경우가 많아 장소 이름으로 쓰지 않는다.
    "subLocality" to address.subLocality,
    "thoroughfare" to address.thoroughfare,
    "locality" to address.locality,
    "subAdministrativeArea" to address.subAdminArea,
    "administrativeArea" to address.adminArea,
    "country" to address.countryName,
    "isoCountryCode" to address.countryCode,
  )

  private fun parseOffset(value: String): Int? {
    val match = Regex("""^([+-])(\d{2}):(\d{2})$""").matchEntire(value.trim()) ?: return null
    val (sign, hours, minutes) = match.destructured
    val total = hours.toInt() * 60 + minutes.toInt()
    return if (sign == "-") -total else total
  }
}
