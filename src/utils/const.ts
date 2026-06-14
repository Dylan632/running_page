import { getEffectiveTheme } from './themeUtils';
import { selectedActivityCopy } from './activityMode';

// Constants
export const MAPBOX_TOKEN =
  'pk.eyJ1IjoieWlob25nMDYxOCIsImEiOiJjbWYxdXR4YncwMTJtMm5zOTE4eTZpMGdtIn0.OnsXdwkZFztR8a5Ph_T-xg';

export const MUNICIPALITY_CITIES_ARR = [
  '北京市',
  '上海市',
  '天津市',
  '重庆市',
  '香港特别行政区',
  '澳门特别行政区',
];

export const MAP_LAYER_LIST = [
  'road-label',
  'waterway-label',
  'natural-line-label',
  'natural-point-label',
  'water-line-label',
  'water-point-label',
  'poi-label',
  'airport-label',
  'settlement-subdivision-label',
  'settlement-label',
  'state-label',
  'country-label',
];

// styling: set to `true` if you want dash-line route
export const USE_DASH_LINE = true;
// styling: route line opacity: [0, 1]
export const LINE_OPACITY = 0.4;
// styling: map height - responsive design
export const MAP_HEIGHT = window.innerWidth <= 768 ? 250 : 600;
// set to `false` if you want to hide the road label characters
export const ROAD_LABEL_DISPLAY = true;
// set to `true` if you want to display only the routes without showing the map
export const PRIVACY_MODE = false;
// set to `true` to show the map tiles by default; `false` keeps only routes visible initially
export const LIGHTS_ON = true;
// set to `true` if you want to show the 'Elevation Gain' column
export const SHOW_ELEVATION_GAIN = false;
// richer title for the activity types (like garmin style)
export const RICH_TITLE = false;

// IF you are outside China please make sure IS_CHINESE = false
export const IS_CHINESE = true;
export const USE_ANIMATION_FOR_GRID = false;

const CHINESE_INFO_MESSAGE = (yearLength: number, year: string): string => {
  const yearStr = year === 'Total' ? '所有' : ` ${year} `;
  return `记录自己${selectedActivityCopy.chineseVerb} ${yearLength} 年了，下面列表展示的是${yearStr}的数据`;
};
const ENGLISH_INFO_MESSAGE = (yearLength: number, year: string): string =>
  `${selectedActivityCopy.journeyTitle} with ${yearLength} Years, the table shows year ${year} data`;

const IS_CYCLING_COPY = selectedActivityCopy.name === 'Ride';

export const CHINESE_LOCATION_INFO_MESSAGE_FIRST = IS_CYCLING_COPY
  ? '骑过了一些地方，希望随着时间推移，点亮的地方越来越多'
  : '跑过了一些地方，希望随着时间推移，点亮的地方越来越多';
export const CHINESE_LOCATION_INFO_MESSAGE_SECOND = IS_CYCLING_COPY
  ? '不要停下来，不要停下继续骑行的车轮'
  : '不要停下来，不要停下奔跑的脚步';

export const INFO_MESSAGE = IS_CHINESE
  ? CHINESE_INFO_MESSAGE
  : ENGLISH_INFO_MESSAGE;

const FULL_MARATHON_RUN_TITLE = IS_CHINESE ? '全程马拉松' : 'Full Marathon';
const HALF_MARATHON_RUN_TITLE = IS_CHINESE ? '半程马拉松' : 'Half Marathon';
const MORNING_RUN_TITLE = IS_CHINESE ? '清晨跑步' : 'Morning Run';
const MIDDAY_RUN_TITLE = IS_CHINESE ? '午间跑步' : 'Midday Run';
const AFTERNOON_RUN_TITLE = IS_CHINESE ? '午后跑步' : 'Afternoon Run';
const EVENING_RUN_TITLE = IS_CHINESE ? '傍晚跑步' : 'Evening Run';
const NIGHT_RUN_TITLE = IS_CHINESE ? '夜晚跑步' : 'Night Run';
const RUN_GENERIC_TITLE = IS_CHINESE ? '跑步' : 'Run';
const RUN_TRAIL_TITLE = IS_CHINESE ? '越野跑' : 'Trail Run';
const RUN_TREADMILL_TITLE = IS_CHINESE ? '跑步机' : 'Treadmill Run';
const HIKING_TITLE = IS_CHINESE ? '徒步' : 'Hiking';
const CYCLING_TITLE = IS_CHINESE ? '骑行' : 'Cycling';
const SKIING_TITLE = IS_CHINESE ? '滑雪' : 'Skiing';
const WALKING_TITLE = IS_CHINESE ? '步行' : 'Walking';
const SWIMMING_TITLE = IS_CHINESE ? '游泳' : 'Swimming';
const ALL_TITLE = IS_CHINESE ? '所有' : 'All';
const ACTIVITY_COUNT_TITLE = IS_CHINESE ? '活动次数' : 'Activity Count';
const MAX_DISTANCE_TITLE = IS_CHINESE ? '最远距离' : 'Max Distance';
const MAX_SPEED_TITLE = IS_CHINESE ? '最快速度' : 'Max Speed';
const TOTAL_TIME_TITLE = IS_CHINESE ? '总时间' : 'Total Time';
const AVERAGE_SPEED_TITLE = IS_CHINESE ? '平均速度' : 'Average Speed';
const TOTAL_DISTANCE_TITLE = IS_CHINESE ? '总距离' : 'Total Distance';
const AVERAGE_DISTANCE_TITLE = IS_CHINESE ? '平均距离' : 'Average Distance';
const TOTAL_ELEVATION_GAIN_TITLE = IS_CHINESE
  ? '总海拔爬升'
  : 'Total Elevation Gain';
const AVERAGE_HEART_RATE_TITLE = IS_CHINESE ? '平均心率' : 'Average Heart Rate';
const YEARLY_TITLE = IS_CHINESE ? 'Year' : 'Yearly';
const MONTHLY_TITLE = IS_CHINESE ? 'Month' : 'Monthly';
const WEEKLY_TITLE = IS_CHINESE ? 'Week' : 'Weekly';
const DAILY_TITLE = IS_CHINESE ? 'Day' : 'Daily';
const LOCATION_TITLE = IS_CHINESE ? 'Location' : 'Location';
export const HOME_PAGE_TITLE = IS_CHINESE ? '首页' : 'Home';

export const LOADING_TEXT = IS_CHINESE ? '加载中...' : 'Loading...';
export const NO_ROUTE_DATA = IS_CHINESE ? '暂无路线数据' : 'No route data';
export const INVALID_ROUTE_DATA = IS_CHINESE
  ? '路线数据无效'
  : 'Invalid route data';

export const ACTIVITY_TYPES = {
  RUN_GENERIC_TITLE,
  RUN_TRAIL_TITLE,
  RUN_TREADMILL_TITLE,
  HIKING_TITLE,
  CYCLING_TITLE,
  SKIING_TITLE,
  WALKING_TITLE,
  SWIMMING_TITLE,
  ALL_TITLE,
};

export const RUN_TITLES = {
  FULL_MARATHON_RUN_TITLE,
  HALF_MARATHON_RUN_TITLE,
  MORNING_RUN_TITLE,
  MIDDAY_RUN_TITLE,
  AFTERNOON_RUN_TITLE,
  EVENING_RUN_TITLE,
  NIGHT_RUN_TITLE,
};

export const ACTIVITY_TOTAL = {
  ACTIVITY_COUNT_TITLE,
  MAX_DISTANCE_TITLE,
  MAX_SPEED_TITLE,
  TOTAL_TIME_TITLE,
  AVERAGE_SPEED_TITLE,
  TOTAL_DISTANCE_TITLE,
  AVERAGE_DISTANCE_TITLE,
  TOTAL_ELEVATION_GAIN_TITLE,
  AVERAGE_HEART_RATE_TITLE,
  YEARLY_TITLE,
  MONTHLY_TITLE,
  WEEKLY_TITLE,
  DAILY_TITLE,
  LOCATION_TITLE,
};

const nike = 'rgb(224,237,94)';
const dark_vanilla = 'rgb(228,212,220)';

// If your map has an offset please change this line
export const NEED_FIX_MAP = false;
export const MAIN_COLOR = nike;
export const PROVINCE_FILL_COLOR = '#47b8e0';
export const COUNTRY_FILL_COLOR = dark_vanilla;

// Static color constants
export const RUN_COLOR_LIGHT = '#47b8e0';
export const RUN_COLOR_DARK = MAIN_COLOR;
