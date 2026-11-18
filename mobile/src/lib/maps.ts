import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Android 지도(Google Maps)는 빌드할 때 넣은 API 키가 있어야 한다 (app.config.ts의 GOOGLE_MAPS_API_KEY).
// 키 없이 MapView를 만들면 'API key not found'로 앱이 바로 꺼지므로, 키가 없는 빌드에서는 지도를 감춘다.
// iOS는 Apple 지도를 써서 키가 필요 없다.
export const mapsAvailable =
  Platform.OS !== 'android' || Boolean(Constants.expoConfig?.android?.config?.googleMaps?.apiKey);
