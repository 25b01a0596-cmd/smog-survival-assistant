import React, { useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Header } from "./components/Header";
import { ParameterSidebar } from "./components/ParameterSidebar";
import { EmptyReadyState } from "./components/EmptyReadyState";
import { TelemetryOverview } from "./components/TelemetryOverview";
import { RoutineSection } from "./components/RoutineSection";
import { IndoorHacksSection } from "./components/IndoorHacksSection";
import { AlternativesSection } from "./components/AlternativesSection";
import { ImpactSection } from "./components/ImpactSection";
import type {
  AssessmentResponse,
  CityCandidate,
  DailyRoutineType,
  VulnerabilityFlags,
} from "./types";

function buildMarkdownBrief(
  assessment: AssessmentResponse,
  adoptedRoutineIds: Record<string, boolean>,
  adoptedHackIds: Record<string, boolean>,
  adoptedAltIds: Record<string, boolean>
): string {
  const { telemetry, plan, requestProfile } = assessment;
  const vulnList = [
    requestProfile.vulnerabilities.children ? "Children" : null,
    requestProfile.vulnerabilities.elderly ? "Elderly (65+)" : null,
    requestProfile.vulnerabilities.asthma ? "Asthma / Respiratory" : null,
  ].filter(Boolean);

  const lines: string[] = [
    `# AtmosGuard Air Quality & Smog Survival Brief — ${telemetry.cityName}`,
    `Location: ${telemetry.regionLabel} (${telemetry.latitude.toFixed(2)}, ${telemetry.longitude.toFixed(2)})`,
    `Observed: ${telemetry.observationTime} (${telemetry.timezone})`,
    `US AQI: ${telemetry.usAqi} (${telemetry.aqiCategory}) | PM2.5: ${telemetry.pm25} ug/m3 | PM10: ${telemetry.pm10} ug/m3 | NO2: ${telemetry.no2} ug/m3 | O3: ${telemetry.o3} ug/m3`,
    `Profile: ${requestProfile.routine} | Household Sensitivities: ${vulnList.length ? vulnList.join(", ") : "Standard adult baseline"}`,
    "",
    `## Briefing Summary`,
    plan.citySummary,
    "",
    `## Respiratory Mask & Safe Window`,
    `- Mask Grade: ${plan.maskProtocol.recommendedGrade} — ${plan.maskProtocol.whenToWear}`,
    `- Best Outdoor Window: ${plan.safeOutdoorWindows.bestWindow} (Avoid: ${plan.safeOutdoorWindows.avoidWindow})`,
    "",
    `## Low-Emission Daily Routine`,
    ...plan.dailyRoutineSchedule.map(
      (r) =>
        `- [${adoptedRoutineIds[r.id] ? "x" : " "}] ${r.timeWindow} (${r.phase}): ${r.action} — ${r.whyItHelps} (-${r.exposureReductionPct}% exposure, ${r.emissionSavedKgCo2} kg CO2/day)`
    ),
    "",
    `## Indoor Air Quality Protocols`,
    ...plan.indoorAirHacks.map(
      (h) =>
        `- [${adoptedHackIds[h.id] ? "x" : " "}] ${h.title} (${h.category} / ${h.priority} / ${h.costTier}): ${h.steps}`
    ),
    "",
    `## Sustainable Alternatives`,
    ...plan.sustainableAlternatives.map(
      (a) =>
        `- [${adoptedAltIds[a.id] ? "x" : " "}] ${a.currentHabit} -> ${a.lowEmissionAlternative}: ${a.citySpecificTip} (${a.annualCo2SavedKg} kg CO2/year)`
    ),
    "",
    `## Health & Environmental Impact`,
    `- Health: ${plan.impactSummary.respiratoryHealthImpact}`,
    `- Environment: ${plan.impactSummary.environmentalImpact}`,
  ];

  return lines.join("\n");
}

export default function App() {
  const [cityInput, setCityInput] = useState("");
  const [selectedCandidate, setSelectedCandidate] =
    useState<CityCandidate | null>(null);
  const [routine, setRoutine] = useState<DailyRoutineType>("Office Commuter");
  const [vulnerabilities, setVulnerabilities] = useState<VulnerabilityFlags>({
    children: false,
    elderly: false,
    asthma: false,
  });

  const [assessment, setAssessment] = useState<AssessmentResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [adoptedRoutineIds, setAdoptedRoutineIds] = useState<Record<string, boolean>>({});
  const [adoptedHackIds, setAdoptedHackIds] = useState<Record<string, boolean>>({});
  const [adoptedAltIds, setAdoptedAltIds] = useState<Record<string, boolean>>({});

  const cityInputRef = useRef<HTMLInputElement | null>(null);

  const handleToggleVulnerability = (key: keyof VulnerabilityFlags) => {
    setVulnerabilities((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const initializeAdoptedMaps = (data: AssessmentResponse) => {
    const rMap: Record<string, boolean> = {};
    data.plan.dailyRoutineSchedule.forEach((r) => {
      rMap[r.id] = true;
    });
    const hMap: Record<string, boolean> = {};
    data.plan.indoorAirHacks.forEach((h) => {
      hMap[h.id] = h.priority === "Essential";
    });
    const aMap: Record<string, boolean> = {};
    data.plan.sustainableAlternatives.forEach((a, idx) => {
      aMap[a.id] = idx < 2;
    });
    setAdoptedRoutineIds(rMap);
    setAdoptedHackIds(hMap);
    setAdoptedAltIds(aMap);
  };

  const runAssessment = async (
    targetCity?: string,
    targetCandidate?: CityCandidate | null,
    targetRoutine?: DailyRoutineType,
    targetVuln?: VulnerabilityFlags
  ) => {
    const finalCity = (targetCity ?? cityInput).trim();
    if (finalCity.length < 2) {
      setErrorMessage("Please enter a city name to generate your plan.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: finalCity,
          cityCandidate:
            targetCandidate !== undefined ? targetCandidate : selectedCandidate,
          routine: targetRoutine ?? routine,
          vulnerabilities: targetVuln ?? vulnerabilities,
        }),
      });

      const payload = (await response.json()) as AssessmentResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to generate air quality plan.");
      }

      setAssessment(payload);
      initializeAdoptedMaps(payload);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Network error while retrieving telemetry and generating plan."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunPreset = (
    presetCity: string,
    presetRoutine: DailyRoutineType,
    presetVuln: VulnerabilityFlags
  ) => {
    setCityInput(presetCity);
    setSelectedCandidate(null);
    setRoutine(presetRoutine);
    setVulnerabilities(presetVuln);
    void runAssessment(presetCity, null, presetRoutine, presetVuln);
  };

  const handleExportBrief = () => {
    if (!assessment) return;
    const markdown = buildMarkdownBrief(
      assessment,
      adoptedRoutineIds,
      adoptedHackIds,
      adoptedAltIds
    );
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `atmosguard-${assessment.telemetry.cityName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleFocusConfig = () => {
    cityInputRef.current?.focus();
    cityInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleSelectAll = () => {
    if (!assessment) return;
    const rMap: Record<string, boolean> = {};
    assessment.plan.dailyRoutineSchedule.forEach((r) => (rMap[r.id] = true));
    const hMap: Record<string, boolean> = {};
    assessment.plan.indoorAirHacks.forEach((h) => (hMap[h.id] = true));
    const aMap: Record<string, boolean> = {};
    assessment.plan.sustainableAlternatives.forEach((a) => (aMap[a.id] = true));
    setAdoptedRoutineIds(rMap);
    setAdoptedHackIds(hMap);
    setAdoptedAltIds(aMap);
  };

  const handleClearAll = () => {
    setAdoptedRoutineIds({});
    setAdoptedHackIds({});
    setAdoptedAltIds({});
  };

  const adoptionStats = useMemo(() => {
    if (!assessment) {
      return {
        hasPlan: false,
        adoptedCount: 0,
        totalCount: 0,
        currentExposureReductionPct: 0,
        currentWeeklyCo2Kg: 0,
      };
    }

    const { plan } = assessment;
    const totalCount =
      plan.dailyRoutineSchedule.length +
      plan.indoorAirHacks.length +
      plan.sustainableAlternatives.length;

    const adoptedCount =
      plan.dailyRoutineSchedule.filter((r) => adoptedRoutineIds[r.id]).length +
      plan.indoorAirHacks.filter((h) => adoptedHackIds[h.id]).length +
      plan.sustainableAlternatives.filter((a) => adoptedAltIds[a.id]).length;

    const exposureItems = [
      ...plan.dailyRoutineSchedule.map((r) => ({
        weight: Math.max(1, r.exposureReductionPct),
        adopted: Boolean(adoptedRoutineIds[r.id]),
      })),
      ...plan.indoorAirHacks.map((h) => ({
        weight: Math.max(1, h.exposureReductionPct),
        adopted: Boolean(adoptedHackIds[h.id]),
      })),
    ];
    const totalW = exposureItems.reduce((s, i) => s + i.weight, 0);
    const activeW = exposureItems
      .filter((i) => i.adopted)
      .reduce((s, i) => s + i.weight, 0);

    const currentExposureReductionPct =
      totalW > 0
        ? Math.round(plan.impactSummary.maxExposureReductionPct * (activeW / totalW))
        : 0;

    const currentWeeklyCo2Kg =
      plan.dailyRoutineSchedule
        .filter((r) => adoptedRoutineIds[r.id])
        .reduce((s, r) => s + r.emissionSavedKgCo2 * 5, 0) +
      plan.sustainableAlternatives
        .filter((a) => adoptedAltIds[a.id])
        .reduce((s, a) => s + a.weeklyCo2SavedKg, 0);

    return {
      hasPlan: true,
      adoptedCount,
      totalCount,
      currentExposureReductionPct,
      currentWeeklyCo2Kg,
    };
  }, [assessment, adoptedRoutineIds, adoptedHackIds, adoptedAltIds]);

  return (
    <div id="top" className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Header
        hasPlan={Boolean(assessment)}
        onExportBrief={handleExportBrief}
        onFocusConfig={handleFocusConfig}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        <div className="flex flex-col lg:flex-row items-start gap-6 lg:gap-8">
          <ParameterSidebar
            cityInput={cityInput}
            onCityInputChange={setCityInput}
            selectedCandidate={selectedCandidate}
            onSelectCandidate={setSelectedCandidate}
            routine={routine}
            onRoutineChange={setRoutine}
            vulnerabilities={vulnerabilities}
            onToggleVulnerability={handleToggleVulnerability}
            onSubmit={() => void runAssessment()}
            isLoading={isLoading}
            inputRef={cityInputRef}
            adoptionStats={adoptionStats}
          />

          <div className="flex-1 min-w-0 w-full space-y-6">
            {errorMessage && (
              <div
                role="alert"
                className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex items-start gap-3 text-sm text-rose-900"
              >
                <AlertCircle
                  className="w-5 h-5 text-rose-600 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <div className="font-semibold">Unable to complete assessment</div>
                  <p className="text-rose-800">{errorMessage}</p>
                </div>
              </div>
            )}

            {isLoading && (
              <div
                aria-busy="true"
                aria-label="Generating air quality survival plan"
                className="space-y-6"
              >
                <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 animate-pulse">
                  <div className="h-4 w-48 bg-slate-200 rounded-xs" />
                  <div className="h-8 w-80 bg-slate-200 rounded-xs" />
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-200">
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className="space-y-2">
                        <div className="h-3 w-24 bg-slate-200 rounded-xs" />
                        <div className="h-7 w-20 bg-slate-200 rounded-xs" />
                      </div>
                    ))}
                  </div>
                  <div className="h-44 w-full bg-slate-100 rounded-md mt-4" />
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3 animate-pulse">
                  <div className="h-5 w-56 bg-slate-200 rounded-xs" />
                  <div className="h-16 w-full bg-slate-100 rounded-md" />
                  <div className="h-16 w-full bg-slate-100 rounded-md" />
                </div>
              </div>
            )}

            {!isLoading && !assessment && (
              <EmptyReadyState onRunPreset={handleRunPreset} />
            )}

            {!isLoading && assessment && (
              <>
                <TelemetryOverview
                  telemetry={assessment.telemetry}
                  plan={assessment.plan}
                />

                <RoutineSection
                  routineType={assessment.requestProfile.routine}
                  schedule={assessment.plan.dailyRoutineSchedule}
                  adoptedIds={adoptedRoutineIds}
                  onToggleAdopt={(id) =>
                    setAdoptedRoutineIds((prev) => ({
                      ...prev,
                      [id]: !prev[id],
                    }))
                  }
                />

                <IndoorHacksSection
                  hacks={assessment.plan.indoorAirHacks}
                  adoptedIds={adoptedHackIds}
                  onToggleAdopt={(id) =>
                    setAdoptedHackIds((prev) => ({
                      ...prev,
                      [id]: !prev[id],
                    }))
                  }
                />

                <AlternativesSection
                  cityName={assessment.telemetry.cityName}
                  alternatives={assessment.plan.sustainableAlternatives}
                  adoptedIds={adoptedAltIds}
                  onToggleAdopt={(id) =>
                    setAdoptedAltIds((prev) => ({
                      ...prev,
                      [id]: !prev[id],
                    }))
                  }
                />

                <ImpactSection
                  assessment={assessment}
                  adoptedRoutineIds={adoptedRoutineIds}
                  adoptedHackIds={adoptedHackIds}
                  adoptedAltIds={adoptedAltIds}
                  onSelectAll={handleSelectAll}
                  onClearAll={handleClearAll}
                />
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>AtmosGuard · Environmental Health & Low-Emission Action Planner</span>
          <span>Live atmospheric telemetry via Open-Meteo · WHO 2021 air quality benchmarks</span>
        </div>
      </footer>
    </div>
  );
}
