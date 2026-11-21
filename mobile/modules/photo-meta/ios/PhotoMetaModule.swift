import AVFoundation
import CoreLocation
import CryptoKit
import ExpoModulesCore
import ImageIO
import Photos
import UIKit
import UniformTypeIdentifiers

// 사진에 들어 있는 좌표·촬영 시간대를 읽는다.
// 기기 위치를 읽는 게 아니라 사진의 좌표를 주소로 바꾸기만 하므로 위치 권한이 필요 없다.
// Cloud에 올릴 파일의 MD5와 효율 보관용 동영상도 여기서 만든다.
public class PhotoMetaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoMeta")

    // 좌표 → 주소. Apple 지오코딩 서버를 쓴다. 결과가 없으면 nil, 네트워크 오류 등은 reject.
    // atMs 시점의 그 지역 UTC 오프셋(분)도 함께 돌려준다 (EXIF에 시간대가 없을 때 대신 쓴다).
    AsyncFunction("reverseGeocode") { (latitude: Double, longitude: Double, localeId: String, atMs: Double) async throws -> [String: Any]? in
      let location = CLLocation(latitude: latitude, longitude: longitude)
      let placemarks = try await CLGeocoder().reverseGeocodeLocation(
        location, preferredLocale: Locale(identifier: localeId))
      guard let place = placemarks.first else {
        return nil
      }

      var result: [String: Any] = [:]
      result["areaOfInterest"] = place.areasOfInterest?.first
      result["subLocality"] = place.subLocality
      result["thoroughfare"] = place.thoroughfare
      result["locality"] = place.locality
      result["subAdministrativeArea"] = place.subAdministrativeArea
      result["administrativeArea"] = place.administrativeArea
      result["country"] = place.country
      result["isoCountryCode"] = place.isoCountryCode
      if let timeZone = place.timeZone {
        let date = Date(timeIntervalSince1970: atMs / 1000)
        result["timeZoneOffsetMinutes"] = timeZone.secondsFromGMT(for: date) / 60
      }
      return result
    }

    // 앱 창이 화면의 어디에 있는지 (화면 좌표, pt). 키보드 위치(UIKeyboardFrameEndUserInfoKey)는 화면 좌표라,
    // iPadOS 창 모드·Stage Manager처럼 창이 화면 가운데에 있을 때 키보드에 가린 높이를 JS에서 구하려면 필요하다.
    // RN ScrollView의 automaticallyAdjustKeyboardInsets는 창 좌표와 화면 좌표를 그대로 비교해 이때 틀린다.
    AsyncFunction("windowFrame") { () -> [String: Double]? in
      let window = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first { $0.isKeyWindow }
      guard let window, let screen = window.windowScene?.screen else { return nil }
      let frame = window.convert(window.bounds, to: screen.coordinateSpace)
      return ["x": frame.origin.x, "y": frame.origin.y, "width": frame.width, "height": frame.height]
    }.runOnQueue(.main)

    // 주어진 사진 중 즐겨찾기로 표시된 것의 id. 정리 후보에서 즐겨찾기를 빼 정리 화면과 수를 맞춘다.
    AsyncFunction("favoriteIds") { (ids: [String]) -> [String] in
      var favorites: [String] = []
      PHAsset.fetchAssets(withLocalIdentifiers: ids, options: assetLookupOptions()).enumerateObjects { asset, _, _ in
        if asset.isFavorite { favorites.append(asset.localIdentifier) }
      }
      return favorites
    }

    // 주어진 사진 중 사진첩에 아직 있는 것의 id. 파일을 열지 않고 한 번에 확인한다 (iCloud에만 있는 사진도 있음으로 센다).
    AsyncFunction("existingIds") { (ids: [String]) -> [String] in
      var existing: [String] = []
      PHAsset.fetchAssets(withLocalIdentifiers: ids, options: assetLookupOptions()).enumerateObjects { asset, _, _ in
        existing.append(asset.localIdentifier)
      }
      return existing
    }

    // 원본 파일의 EXIF OffsetTimeOriginal("+09:00") → 분 단위 오프셋. 없으면 nil.
    Function("readCaptureOffset") { (uri: String) -> Int? in
      guard
        let url = URL(string: uri),
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
        let exif = properties[kCGImagePropertyExifDictionary as String] as? [String: Any]
      else {
        return nil
      }
      let value =
        (exif["OffsetTimeOriginal"] ?? exif["OffsetTimeDigitized"] ?? exif["OffsetTime"]) as? String
      return value.flatMap(parseOffset)
    }

    // 파일의 MD5(hex). 몇 GB짜리 동영상도 올리므로 파일 전체를 메모리에 올리지 않고 조금씩 읽는다.
    AsyncFunction("md5File") { (uri: String) throws -> String in
      guard let url = URL(string: uri) else {
        throw Exception(name: "InvalidUri", description: "Invalid file uri: \(uri)")
      }
      let handle = try FileHandle(forReadingFrom: url)
      defer { try? handle.close() }
      var hash = Insecure.MD5()
      while true {
        let chunk = autoreleasepool { handle.readData(ofLength: 1024 * 1024) }
        if chunk.isEmpty { break }
        hash.update(data: chunk)
      }
      return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    // ImageManipulator가 만든 JPEG에 촬영 시각·시간대·GPS를 다시 기록한다. 원본의 제조사 전용
    // MakerNote 등은 복사하지 않아 불필요한 개인정보이나 호환성 문제를 효율 파일에 넣지 않는다.
    AsyncFunction("writeImageMetadata") { (
      uri: String, metadata: [String: Any]
    ) throws in
      guard
        let url = URL(string: uri),
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let capturedText = metadata["takenAt"] as? String,
        let captured = ISO8601DateFormatter().date(from: capturedText)
      else {
        throw Exception(name: "InvalidImageMetadata", description: "Cannot write image metadata")
      }
      let offset = metadata["takenTzOffset"] as? Int
      let timezone = TimeZone(secondsFromGMT: (offset ?? 0) * 60) ?? TimeZone(identifier: "UTC")!
      let formatter = DateFormatter()
      formatter.locale = Locale(identifier: "en_US_POSIX")
      formatter.timeZone = timezone
      formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
      let dateTime = formatter.string(from: captured)
      let gpsFormatter = DateFormatter()
      gpsFormatter.locale = Locale(identifier: "en_US_POSIX")
      gpsFormatter.timeZone = TimeZone(identifier: "UTC")
      gpsFormatter.dateFormat = "yyyy:MM:dd"
      let gpsDate = gpsFormatter.string(from: captured)
      gpsFormatter.dateFormat = "HH:mm:ss"
      let gpsTime = gpsFormatter.string(from: captured).split(separator: ":")

      var properties = (CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]) ?? [:]
      var exif = (properties[kCGImagePropertyExifDictionary as String] as? [String: Any]) ?? [:]
      exif[kCGImagePropertyExifDateTimeOriginal as String] = dateTime
      exif[kCGImagePropertyExifDateTimeDigitized as String] = dateTime
      if let offset {
        let text = offsetText(offset)
        exif["OffsetTimeOriginal"] = text
        exif["OffsetTimeDigitized"] = text
        exif["OffsetTime"] = text
      }
      properties[kCGImagePropertyExifDictionary as String] = exif
      var tiff = (properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any]) ?? [:]
      tiff[kCGImagePropertyTIFFDateTime as String] = dateTime
      tiff[kCGImagePropertyTIFFOrientation as String] = 1
      properties[kCGImagePropertyTIFFDictionary as String] = tiff
      if let latitude = metadata["lat"] as? Double, let longitude = metadata["lng"] as? Double,
        latitude.isFinite, longitude.isFinite, abs(latitude) <= 90, abs(longitude) <= 180 {
        var gps = (properties[kCGImagePropertyGPSDictionary as String] as? [String: Any]) ?? [:]
        gps[kCGImagePropertyGPSLatitude as String] = abs(latitude)
        gps[kCGImagePropertyGPSLatitudeRef as String] = latitude < 0 ? "S" : "N"
        gps[kCGImagePropertyGPSLongitude as String] = abs(longitude)
        gps[kCGImagePropertyGPSLongitudeRef as String] = longitude < 0 ? "W" : "E"
        gps[kCGImagePropertyGPSDateStamp as String] = gpsDate
        if gpsTime.count == 3 {
          gps[kCGImagePropertyGPSTimeStamp as String] = gpsTime.map { Double($0) ?? 0 }
        }
        properties[kCGImagePropertyGPSDictionary as String] = gps
      }
      let temporary = url.appendingPathExtension("metadata")
      try? FileManager.default.removeItem(at: temporary)
      guard let destination = CGImageDestinationCreateWithURL(temporary as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
        throw Exception(name: "ImageWriteFailed", description: "Cannot create image destination")
      }
      CGImageDestinationAddImageFromSource(destination, source, 0, properties as CFDictionary)
      guard CGImageDestinationFinalize(destination) else {
        try? FileManager.default.removeItem(at: temporary)
        throw Exception(name: "ImageWriteFailed", description: "Cannot write image metadata")
      }
      // 원본을 먼저 지우면 move 실패 때 사진을 잃는다. replace는 같은 볼륨 안에서 원자적으로 교체한다.
      _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary, backupItemName: nil, options: [])
    }

    // 동영상을 짧은 변 720px 이하의 H.264 mp4로 줄인다 (효율 보관). 원래 작으면 키우지 않는다.
    AsyncFunction("transcodeVideo") { (inputUri: String, outputUri: String) async throws in
      guard let input = URL(string: inputUri), let output = URL(string: outputUri) else {
        throw Exception(name: "InvalidUri", description: "Invalid file uri")
      }
      try? FileManager.default.removeItem(at: output)
      let asset = AVURLAsset(url: input)
      guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720)
      else {
        throw Exception(name: "ExportUnavailable", description: "Cannot export this video")
      }
      session.outputURL = output
      session.outputFileType = .mp4
      session.shouldOptimizeForNetworkUse = true
      // iOS 15.5를 지원하므로 async export(iOS 18) 대신 완료 콜백을 쓴다.
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        session.exportAsynchronously {
          if session.status == .completed {
            continuation.resume()
          } else {
            continuation.resume(
              throwing: session.error
                ?? Exception(name: "ExportFailed", description: "Video export did not complete"))
          }
        }
      }
    }
  }
}

private func parseOffset(_ value: String) -> Int? {
  // "+09:00", "-03:30". Swift Regex 리터럴은 iOS 16+라 직접 나눈다 (최소 버전 15.5).
  let text = Array(value.trimmingCharacters(in: .whitespaces))
  guard text.count == 6, text[0] == "+" || text[0] == "-", text[3] == ":",
    let hours = Int(String(text[1...2])), let minutes = Int(String(text[4...5]))
  else {
    return nil
  }
  let total = hours * 60 + minutes
  return text[0] == "-" ? -total : total
}

private func offsetText(_ minutes: Int) -> String {
  let sign = minutes < 0 ? "-" : "+"
  let value = abs(minutes)
  return String(format: "%@%02d:%02d", sign, value / 60, value % 60)
}

// id로 사진을 찾을 때의 조건. expo-media-library(getAssetInfoAsync)와 같게 가린 사진·연사 사진도 찾는다.
// 빠뜨리면 사진 앱에서 가린 사진을 지워진 사진으로 잘못 본다.
private func assetLookupOptions() -> PHFetchOptions {
  let options = PHFetchOptions()
  options.includeHiddenAssets = true
  options.includeAllBurstAssets = true
  return options
}
