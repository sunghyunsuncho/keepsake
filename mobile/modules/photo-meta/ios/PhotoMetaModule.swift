import AVFoundation
import CoreLocation
import CryptoKit
import ExpoModulesCore
import ImageIO

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
