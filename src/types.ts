export type DailyRoutineType =
  | "Work from Home"
  | "Office Commuter"
  | "Student"
  | "Outdoor Worker";

export interface VulnerabilityFlags {
  children: boolean;
  elderly: boolean;
  asthma: boolean;
}

export interface CityCandidate {
  id: number;
  name: string;
  admin1?: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export interface HourlyAqiPoint {
  time: string;
  hourLabel: string;
  usAqi: number;
  pm25: number;
}

export interface CityTelemetry {
  cityName: string;
  regionLabel: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  observationTime: string;
  usAqi: number;
  aqiCategory:
    | "Good"
    | "Moderate"
    | "Unhealthy for Sensitive Groups"
    | "Unhealthy"
    | "Very Unhealthy"
    | "Hazardous";
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
  co: number;
  so2: number;
  temperatureC: number;
  humidityPct: number;
  windSpeedKmh: number;
  dominantPollutant: string;
  whoPm25Ratio: number;
  hourlyForecast: HourlyAqiPoint[];
}

export interface RoutineBlock {
  id: string;
  timeWindow: string;
  phase: "Morning" | "Midday" | "Afternoon" | "Evening";
  action: string;
  whyItHelps: string;
  emissionSavedKgCo2: number;
  exposureReductionPct: number;
}

export interface IndoorHack {
  id: string;
  title: string;
  category: "Filtration" | "Ventilation" | "Source Control" | "Humidity & Surfaces";
  priority: "Essential" | "Recommended";
  costTier: "Free" | "Low-Cost" | "Equipment";
  steps: string;
  effectivenessNote: string;
  exposureReductionPct: number;
}

export interface SustainableAlternative {
  id: string;
  currentHabit: string;
  lowEmissionAlternative: string;
  citySpecificTip: string;
  annualCo2SavedKg: number;
  weeklyCo2SavedKg: number;
  pmReductionImpact: string;
}

export interface ImpactComparisonRow {
  label: string;
  baselineValue: number;
  withPlanValue: number;
  unit: string;
}

export interface HouseholdAlert {
  group: "Children" | "Elderly (65+)" | "Asthma / Respiratory";
  thresholdNote: string;
  protectiveProtocol: string;
}

export interface SmogSurvivalPlan {
  citySummary: string;
  riskRating: "Low" | "Elevated" | "High" | "Severe";
  maskProtocol: {
    recommendedGrade: string;
    whenToWear: string;
    fitCheckNote: string;
  };
  safeOutdoorWindows: {
    bestWindow: string;
    avoidWindow: string;
    rationale: string;
  };
  householdAlerts: HouseholdAlert[];
  dailyRoutineSchedule: RoutineBlock[];
  indoorAirHacks: IndoorHack[];
  sustainableAlternatives: SustainableAlternative[];
  impactSummary: {
    baselineDailyPm25ExposureUg: number;
    protectedDailyPm25ExposureUg: number;
    maxExposureReductionPct: number;
    weeklyCo2AvoidedKg: number;
    respiratoryHealthImpact: string;
    environmentalImpact: string;
    comparisonMetrics: ImpactComparisonRow[];
  };
}

export interface AssessmentResponse {
  telemetry: CityTelemetry;
  plan: SmogSurvivalPlan;
  requestProfile: {
    routine: DailyRoutineType;
    vulnerabilities: VulnerabilityFlags;
  };
}
