package expo.modules.photometa

import android.location.Address
import android.location.Geocoder
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

// 사진에 들어 있는 좌표·촬영 시간대를 읽는다.
// Android Geocoder 자체는 위치 권한이 필요 없다 (기기 위치가 아니라 주어진 좌표를 변환한다).
class PhotoMetaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PhotoMeta")

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
