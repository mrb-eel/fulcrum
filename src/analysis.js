import { simulatePosition, findCriticalShock } from "./risk-engine.js";
import { buildObservedExitOptions, buildDecisionFrontier } from "./decision-engine.js";

/** Shared by the API and browser: every calculation uses this exact packet. */
export function analyzePacket(packet, parameters = {}) {
  const trace = packet.snapshot?.rawInputs?.oracleInvestigation;
  if (trace?.oracle?.isPrimary === false || (trace && trace.conclusion?.classification !== "confirmed_static_primary_with_usde_aware_backup")) {
    throw new Error("The oracle configuration has changed. Review the new feed before using this case model.");
  }
  const { underlyingHaircut = 0.005, exitDiscount = 0.01, lossLimit = 0.1, oracleMode, oracleTransmission, eventProbability = null } = parameters;
  const scenario = simulatePosition(packet.snapshot, { underlyingHaircut, exitDiscount, oracleMode, oracleTransmission });
  const critical = findCriticalShock(packet.snapshot, { lossLimit, oracleMode, oracleTransmission });
  let decision;
  try {
    decision = buildDecisionFrontier({ simulation: scenario, exitOptions: buildObservedExitOptions(packet.snapshot, scenario), eventProbability });
  } catch (error) {
    decision = Object.freeze({
      status: "unavailable",
      snapshotId: scenario.snapshotId,
      reason: error.message,
      limitation: "Risk and loss calculations remain available. Decision comparison is withheld until a quote with matching assets and native amounts is recorded."
    });
  }
  const baseline = scenario.baseline;
  const targetCollateralLoss = lossLimit * baseline.equityUsd / baseline.exitValueUsd;
  const thresholdExitDiscount = underlyingHaircut === 1 ? 0 : Math.max(0, 1 - (1 - targetCollateralLoss) / (1 - underlyingHaircut));
  const curve = Array.from({ length: 41 }, (_, index) => {
    const discount = index / 400;
    const simulation = simulatePosition(packet.snapshot, { underlyingHaircut, exitDiscount: discount, oracleMode, oracleTransmission });
    return { exitDiscount: discount, equityLossFraction: simulation.result.equityLossFraction };
  });
  return { scenario, critical, decision, thresholdExitDiscount, curve };
}
