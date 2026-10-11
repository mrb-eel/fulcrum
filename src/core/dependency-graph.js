import { evidenceById } from "./evidence.js";

const CAPABILITIES = new Set(["value", "access", "escape"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateDependencyGraph(graph, ledger) {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  assert(nodeIds.size === graph.nodes.length, "Dependency graph node ids must be unique.");
  const evidence = evidenceById(ledger);
  for (const edge of graph.edges) {
    assert(nodeIds.has(edge.from) && nodeIds.has(edge.to), `Edge '${edge.id}' has an unknown node.`);
    assert(CAPABILITIES.has(edge.capability), `Edge '${edge.id}' has an unknown capability.`);
    assert(edge.evidenceIds?.length, `Edge '${edge.id}' requires evidence.`);
    for (const evidenceId of edge.evidenceIds) {
      assert(evidence.has(evidenceId), `Edge '${edge.id}' references missing evidence '${evidenceId}'.`);
    }
  }
  return graph;
}

export function findDependencyPaths(graph, start, target, capability) {
  const paths = [];
  function walk(current, visited, edges) {
    if (current === target) {
      paths.push(edges);
      return;
    }
    for (const edge of graph.edges) {
      if (edge.from !== current || (capability && edge.capability !== capability) || visited.has(edge.to)) continue;
      walk(edge.to, new Set([...visited, edge.to]), [...edges, edge]);
    }
  }
  walk(start, new Set([start]), []);
  return paths;
}

export function buildSelectedCaseGraph({ ledger, oracleExitState }) {
  const graph = {
    schemaVersion: "dependency-graph/v1",
    nodes: [
      { id: "ethereum", label: "Ethereum", type: "settlement" },
      { id: "ethena", label: "Ethena", type: "yield-source" },
      { id: "susde", label: "sUSDe", type: "yield-bearing-asset" },
      { id: "pt", label: "PT-sUSDe", type: "principal-token" },
      { id: "pendle", label: "Pendle market", type: "exit-venue" },
      { id: "oracle", label: "Morpho oracle", type: "valuation-source" },
      { id: "morpho", label: "Morpho market", type: "lending-market" },
      { id: "position", label: "Public position", type: "position" }
    ],
    edges: [
      { id: "ethereum-settles-ethena", from: "ethereum", to: "ethena", capability: "access", evidenceIds: ["settlement-chain"] },
      { id: "ethena-issues-susde", from: "ethena", to: "susde", capability: "value", evidenceIds: ["yield-source"] },
      { id: "susde-underlies-pt", from: "susde", to: "pt", capability: "value", evidenceIds: ["pt-underlying"] },
      { id: "pendle-exits-pt", from: "pendle", to: "pt", capability: "escape", evidenceIds: ["pendle-exit-quote"] },
      { id: "pt-valued-by-oracle", from: "pt", to: "oracle", capability: "value", evidenceIds: ["morpho-oracle", "oracle-architecture"] },
      {
        id: "pendle-oracle-hypothesis",
        from: "pendle",
        to: "oracle",
        capability: "value",
        state: oracleExitState,
        evidenceIds: ["oracle-exit-tomography", "oracle-architecture"]
      },
      { id: "oracle-constrains-morpho", from: "oracle", to: "morpho", capability: "value", evidenceIds: ["morpho-collateral-rule"] },
      { id: "morpho-constrains-position", from: "morpho", to: "position", capability: "access", evidenceIds: ["public-position-state"] }
    ]
  };
  return validateDependencyGraph(graph, ledger);
}
