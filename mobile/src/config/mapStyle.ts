import Config from 'react-native-config';

export const MAPBOX_STANDARD_STYLE_URL = 'mapbox://styles/mapbox/standard';

export const PARKWALK_MAP_STYLE_URL =
  Config.MAPBOX_STYLE_URL?.trim() || MAPBOX_STANDARD_STYLE_URL;
