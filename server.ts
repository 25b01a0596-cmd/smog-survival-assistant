import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  CityCandidate,
  CityTelemetry,
  DailyRoutineType,
  HourlyAqiPoint,
  SmogSurvivalPlan,
  VulnerabilityFlags,
} from "./src/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured in environment variables. Check Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function classifyUsAqi(aqi: number): CityTelemetry["aqiCategory"] {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

function determineDominantPollutant(metrics: {
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
  so2: number;
}): string {
  // Ratio against WHO 2021 short-term guideline thresholds (ug/m3)
  const ratios = [
    { name: "PM2.5 Fine Particulates", ratio: metrics.pm25 / 15 },
    { name: "PM10 Coarse Dust", ratio: metrics.pm10 / 45 },
    { name: "NO2 Traffic Emissions", ratio: metrics.no2 / 25 },
    { name: "O3 Ground-Level Ozone", ratio: metrics.o3 / 100 },
    { name: "SO2 Sulfur Dioxide", ratio: metrics.so2 / 40 },
  ];
  ratios.sort((a, b) => b.ratio - a.ratio);
  return ratios[0].name;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 10000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Upstream API responded with status ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeCity(query: string): Promise<CityCandidate[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    query.trim()
  )}&count=6&language=en&format=json`;
  const data = await fetchJsonWithTimeout<{
    results?: Array<{
      id: number;
      name: string;
      admin1?: string;
      country?: string;
      latitude: number;
      longitude: number;
      timezone?: string;
    }>;
  }>(url);

  if (!data.results || data.results.length === 0) {
    return [];
  }

  return data.results.map((r) => ({
    id: r.id,
    name: r.name,
    admin1: r.admin1,
    country: r.country ?? "Unknown",
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
  }));
}

async function fetchCityTelemetry(candidate: CityCandidate): Promise<CityTelemetry> {
  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${candidate.latitude}&longitude=${candidate.longitude}&current=us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone&hourly=pm2_5,us_aqi&forecast_days=2&timezone=auto`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${candidate.latitude}&longitude=${candidate.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&timezone=auto`;

  const [aqData, weatherData] = await Promise.all([
    fetchJsonWithTimeout<{
      timezone?: string;
      current?: {
        time: string;
        us_aqi?: number;
        pm10?: number;
        pm2_5?: number;
        carbon_monoxide?: number;
        nitrogen_dioxide?: number;
        sulphur_dioxide?: number;
        ozone?: number;
      };
      hourly?: {
        time: string[];
        pm2_5: Array<number | null>;
        us_aqi: Array<number | null>;
      };
    }>(aqUrl),
    fetchJsonWithTimeout<{
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
      };
    }>(weatherUrl),
  ]);

  const currentAq = aqData.current;
  if (!currentAq) {
    throw new Error("Live air quality readings unavailable for this location.");
  }

  const usAqi = Math.round(currentAq.us_aqi ?? 0);
  const pm25 = Number((currentAq.pm2_5 ?? 0).toFixed(1));
  const pm10 = Number((currentAq.pm10 ?? 0).toFixed(1));
  const no2 = Number((currentAq.nitrogen_dioxide ?? 0).toFixed(1));
  const o3 = Number((currentAq.ozone ?? 0).toFixed(1));
  const co = Number((currentAq.carbon_monoxide ?? 0).toFixed(0));
  const so2 = Number((currentAq.sulphur_dioxide ?? 0).toFixed(1));

  // Build next 24 hours starting at current local hour
  const hourlyForecast: HourlyAqiPoint[] = [];
  if (aqData.hourly?.time?.length) {
    const currentPrefix = currentAq.time.slice(0, 13); // YYYY-MM-DDTHH
    let startIdx = aqData.hourly.time.findIndex((t) => t.startsWith(currentPrefix));
    if (startIdx < 0) startIdx = 0;

    for (let i = startIdx; i < Math.min(startIdx + 24, aqData.hourly.time.length); i++) {
      const timeStr = aqData.hourly.time[i];
      const hourPart = timeStr.slice(11, 16);
      hourlyForecast.push({
        time: timeStr,
        hourLabel: hourPart,
        usAqi: Math.round(aqData.hourly.us_aqi[i] ?? usAqi),
        pm25: Number((aqData.hourly.pm2_5[i] ?? pm25).toFixed(1)),
      });
    }
  }

  return {
    cityName: candidate.name,
    regionLabel: candidate.admin1 ? `${candidate.admin1}, ${candidate.country}` : candidate.country,
    country: candidate.country,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    timezone: aqData.timezone ?? candidate.timezone ?? "UTC",
    observationTime: currentAq.time,
    usAqi,
    aqiCategory: classifyUsAqi(usAqi),
    pm25,
    pm10,
    no2,
    o3,
    co,
    so2,
    temperatureC: Number((weatherData.current?.temperature_2m ?? 0).toFixed(1)),
    humidityPct: Math.round(weatherData.current?.relative_humidity_2m ?? 0),
    windSpeedKmh: Number((weatherData.current?.wind_speed_10m ?? 0).toFixed(1)),
    dominantPollutant: determineDominantPollutant({ pm25, pm10, no2, o3, so2 }),
    whoPm25Ratio: Number((pm25 / 15).toFixed(1)),
    hourlyForecast,
  };
}


function extractReadableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: number } };
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // not JSON
  }
  return raw;
}

async function generateSurvivalPlan(
  telemetry: CityTelemetry,
  routine: DailyRoutineType,
  vulnerabilities: VulnerabilityFlags
): Promise<SmogSurvivalPlan> {
  const ai = getAiClient();

  const selectedVulnerabilities: string[] = [];
  if (vulnerabilities.children) selectedVulnerabilities.push("Children at home");
  if (vulnerabilities.elderly) selectedVulnerabilities.push("Elderly (65+) at home");
  if (vulnerabilities.asthma) selectedVulnerabilities.push("Asthma / respiratory patients at home");

  const hourlySummary = telemetry.hourlyForecast
    .slice(0, 24)
    .map((h) => `${h.hourLabel}: AQI ${h.usAqi} (PM2.5 ${h.pm25})`)
    .join(", ");

  const prompt = `
Generate a structured, city-specific Smog Survival & Low-Emission Action Plan as valid JSON matching the exact schema below.

CITY & LIVE TELEMETRY:
- City: ${telemetry.cityName}, ${telemetry.regionLabel}
- Current US AQI: ${telemetry.usAqi} (${telemetry.aqiCategory})
- PM2.5: ${telemetry.pm25} µg/m³ (${telemetry.whoPm25Ratio}x WHO 24h guideline of 15 µg/m³)
- PM10: ${telemetry.pm10} µg/m³ | NO2: ${telemetry.no2} µg/m³ | O3: ${telemetry.o3} µg/m³ | SO2: ${telemetry.so2} µg/m³ | CO: ${telemetry.co} µg/m³
- Dominant Pollutant: ${telemetry.dominantPollutant}
- Weather: ${telemetry.temperatureC}°C, ${telemetry.humidityPct}% relative humidity, ${telemetry.windSpeedKmh} km/h wind
- Next 24h Hourly Forecast: ${hourlySummary}

USER PROFILE:
- Daily Routine: ${routine}
- Vulnerable Household Members: ${
    selectedVulnerabilities.length > 0 ? selectedVulnerabilities.join(", ") : "None specified (healthy adult baseline)"
  }

REQUIREMENTS:
1. Reference actual 24h forecast hours for bestWindow and avoidWindow.
2. householdAlerts: ONLY include entries for checked vulnerable groups (${
    selectedVulnerabilities.length > 0 ? selectedVulnerabilities.join(", ") : "empty array []"
  }). Valid group values: "Children" | "Elderly (65+)" | "Asthma / Respiratory".
3. dailyRoutineSchedule: 4 blocks ("Morning", "Midday", "Afternoon", "Evening") tailored to a ${routine} in ${telemetry.cityName}.
4. indoorAirHacks: 4 science-backed hacks across "Filtration", "Ventilation", "Source Control", "Humidity & Surfaces". priority: "Essential" | "Recommended". costTier: "Free" | "Low-Cost" | "Equipment". exposureReductionPct: number (8 to 28).
5. sustainableAlternatives: 4 city-realistic low-emission swaps in ${telemetry.cityName} (annualCo2SavedKg ≈ weeklyCo2SavedKg * 52).
6. impactSummary: realistic baselineDailyPm25ExposureUg vs protectedDailyPm25ExposureUg given PM2.5=${telemetry.pm25} µg/m³, maxExposureReductionPct (25..78), weeklyCo2AvoidedKg, respiratoryHealthImpact, environmentalImpact, and 3 comparisonMetrics.

JSON SHAPE (return ONLY valid JSON matching these keys):
{
  "citySummary": "string (2 crisp sentences)",
  "riskRating": "Low" | "Elevated" | "High" | "Severe",
  "maskProtocol": { "recommendedGrade": "string", "whenToWear": "string", "fitCheckNote": "string" },
  "safeOutdoorWindows": { "bestWindow": "string", "avoidWindow": "string", "rationale": "string" },
  "householdAlerts": [{ "group": "Children" | "Elderly (65+)" | "Asthma / Respiratory", "thresholdNote": "string", "protectiveProtocol": "string" }],
  "dailyRoutineSchedule": [{ "id": "r1", "timeWindow": "07:00-09:00", "phase": "Morning", "action": "string", "whyItHelps": "string", "emissionSavedKgCo2": 1.2, "exposureReductionPct": 18 }],
  "indoorAirHacks": [{ "id": "h1", "title": "string", "category": "Filtration", "priority": "Essential", "costTier": "Low-Cost", "steps": "string", "effectivenessNote": "string", "exposureReductionPct": 22 }],
  "sustainableAlternatives": [{ "id": "a1", "currentHabit": "string", "lowEmissionAlternative": "string", "citySpecificTip": "string", "annualCo2SavedKg": 420, "weeklyCo2SavedKg": 8.1, "pmReductionImpact": "string" }],
  "impactSummary": {
    "baselineDailyPm25ExposureUg": 48.0,
    "protectedDailyPm25ExposureUg": 19.5,
    "maxExposureReductionPct": 59,
    "weeklyCo2AvoidedKg": 16.4,
    "respiratoryHealthImpact": "string",
    "environmentalImpact": "string",
    "comparisonMetrics": [{ "label": "string", "baselineValue": 48, "withPlanValue": 19.5, "unit": "µg/m³" }]
  }
}
`;

  const attempts: Array<{
    model: string;
    thinkingLevel: ThinkingLevel;
    timeoutMs: number;
  }> = [
    { model: "gemini-4-hydrogen", thinkingLevel: ThinkingLevel.LOW, timeoutMs: 11000 },
    { model: "gemini-3.1-flash-lite", thinkingLevel: ThinkingLevel.MINIMAL, timeoutMs: 15000 },
  ];

  let lastError: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const { model, thinkingLevel, timeoutMs } = attempts[i];
    const t0 = Date.now();
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction:
            "You are an environmental health scientist and urban air quality advisor. Return concise, evidence-based, locally grounded JSON recommendations.",
          thinkingConfig: { thinkingLevel },
          responseMimeType: "application/json",
          httpOptions: { timeout: timeoutMs },
        },
      });
      console.log(`[AtmosGuard] ${model} responded in ${Date.now() - t0}ms`);

      const rawText = response.text;
      if (!rawText) {
        throw new Error("Model returned an empty response.");
      }
      return JSON.parse(rawText) as SmogSurvivalPlan;
    } catch (err) {
      const readable = extractReadableError(err);
      console.error(
        `[AtmosGuard] ${model} attempt ${i + 1} failed after ${Date.now() - t0}ms: ${readable}`
      );
      lastError = new Error(readable);
      if (i < attempts.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to generate survival plan.");
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/cities/suggest", async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      if (q.trim().length < 2) {
        res.json({ results: [] });
        return;
      }
      const results = await geocodeCity(q);
      res.json({ results });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to search cities";
      res.status(502).json({ error: message });
    }
  });

  app.post("/api/telemetry", async (req, res) => {
    try {
      const { city, cityCandidate } = req.body as {
        city?: string;
        cityCandidate?: CityCandidate;
      };
      let resolvedCity = cityCandidate;
      if (!resolvedCity) {
        if (!city || typeof city !== "string" || city.trim().length < 2) {
          res.status(400).json({ error: "Please enter a valid city name." });
          return;
        }
        const candidates = await geocodeCity(city);
        if (candidates.length === 0) {
          res.status(404).json({
            error: `Could not find "${city.trim()}". Try entering the city name without extra punctuation or pick from the suggestions.`,
          });
          return;
        }
        resolvedCity = candidates[0];
      }
      const telemetry = await fetchCityTelemetry(resolvedCity);
      res.json({ telemetry });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch telemetry";
      res.status(502).json({ error: message });
    }
  });

  app.post("/api/plan", async (req, res) => {
    const reqStart = Date.now();
    try {
      const { city, cityCandidate, routine, vulnerabilities } = req.body as {
        city?: string;
        cityCandidate?: CityCandidate;
        routine?: DailyRoutineType;
        vulnerabilities?: VulnerabilityFlags;
      };

      const validRoutines: DailyRoutineType[] = [
        "Work from Home",
        "Office Commuter",
        "Student",
        "Outdoor Worker",
      ];

      if (!routine || !validRoutines.includes(routine)) {
        res.status(400).json({ error: "Please select a valid daily routine." });
        return;
      }

      let resolvedCity = cityCandidate;
      if (!resolvedCity) {
        if (!city || typeof city !== "string" || city.trim().length < 2) {
          res.status(400).json({ error: "Please enter a valid city name." });
          return;
        }
        const candidates = await geocodeCity(city);
        if (candidates.length === 0) {
          res.status(404).json({
            error: `Could not find "${city.trim()}". Try entering the city name without extra punctuation or pick from the suggestions.`,
          });
          return;
        }
        resolvedCity = candidates[0];
      }

      const safeVulnerabilities: VulnerabilityFlags = {
        children: Boolean(vulnerabilities?.children),
        elderly: Boolean(vulnerabilities?.elderly),
        asthma: Boolean(vulnerabilities?.asthma),
      };

      const t1 = Date.now();
      const telemetry = await fetchCityTelemetry(resolvedCity);
      console.log(`[AtmosGuard] Telemetry fetched for ${resolvedCity.name} in ${Date.now() - t1}ms`);

      const plan = await generateSurvivalPlan(telemetry, routine, safeVulnerabilities);
      console.log(`[AtmosGuard] Full /api/plan finished in ${Date.now() - reqStart}ms`);

      res.json({
        telemetry,
        plan,
        requestProfile: {
          routine,
          vulnerabilities: safeVulnerabilities,
        },
      });
    } catch (error) {
      console.error(`[AtmosGuard] Error in /api/plan after ${Date.now() - reqStart}ms:`, error);
      const message =
        error instanceof Error ? error.message : "Unexpected server error while generating plan.";
      res.status(502).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AtmosGuard server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
