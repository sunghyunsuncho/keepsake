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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

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

    // ImageManipulator가 새 JPEG를 쓸 때 잃는 핵심 EXIF를 다시 넣는다. 제조사 전용 MakerNote 등은
    // 복사하지 않아 개인정보·깨진 미리보기 데이터를 효율 파일에 싣지 않는다.
    AsyncFunction("writeImageMetadata") { uri: String, metadata: Map<String, Any?> ->
      val path = Uri.parse(uri).path ?: throw CodedException("Invalid file uri")
      val takenAt = metadata["takenAt"] as? String ?: throw CodedException("Missing capture time")
      val offsetMinutes = (metadata["takenTzOffset"] as? Number)?.toInt()
      val captured = parseIsoDate(takenAt) ?: throw CodedException("Invalid capture time")
      val zone = TimeZone.getTimeZone("GMT${offsetName(offsetMinutes ?: 0)}")
      val dateTime = SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).apply { timeZone = zone }.format(captured)
      ExifInterface(path).apply {
        setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, dateTime)
        setAttribute(ExifInterface.TAG_DATETIME_DIGITIZED, dateTime)
        setAttribute(ExifInterface.TAG_DATETIME, dateTime)
        if (offsetMinutes != null) {
          val offset = offsetName(offsetMinutes)
          setAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL, offset)
          setAttribute(ExifInterface.TAG_OFFSET_TIME_DIGITIZED, offset)
          setAttribute(ExifInterface.TAG_OFFSET_TIME, offset)
        }
        val latitude = (metadata["lat"] as? Number)?.toDouble()
        val longitude = (metadata["lng"] as? Number)?.toDouble()
        if (latitude != null && longitude != null && latitude.isFinite() && longitude.isFinite()
          && kotlin.math.abs(latitude) <= 90 && kotlin.math.abs(longitude) <= 180) {
          setLatLong(latitude, longitude)
          val utc = TimeZone.getTimeZone("UTC")
          val gpsDate = SimpleDateFormat("yyyy:MM:dd", Locale.US).apply { timeZone = utc }.format(captured)
          val gpsClock = SimpleDateFormat("HH:mm:ss", Locale.US).apply { timeZone = utc }.format(captured).split(':')
          setAttribute(ExifInterface.TAG_GPS_DATESTAMP, gpsDate)
          setAttribute(ExifInterface.TAG_GPS_TIMESTAMP, "${gpsClock[0]}/1,${gpsClock[1]}/1,${gpsClock[2]}/1")
        }
        // ImageManipulator가 픽셀을 회전한 뒤 저장하므로 다시 회전되지 않게 한다.
        setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL.toString())
        saveAttributes()
      }
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

  private fun parseIsoDate(value: String): Date? {
    val patterns = arrayOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")
    for (pattern in patterns) {
      try {
        return SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(value)
      } catch (_: Exception) {
        // 다음 형식도 시도한다.
      }
    }
    return null
  }

  private fun offsetName(minutes: Int): String {
    val sign = if (minutes < 0) "-" else "+"
    val absolute = kotlin.math.abs(minutes)
    return "%s%02d:%02d".format(Locale.US, sign, absolute / 60, absolute % 60)
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
