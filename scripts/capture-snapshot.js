import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchLiveCaseInputs } from "../src/providers.js";
import { createLiveEvidenceSnapshot } from "../src/live-evidence-snapshot.js";

const observedAt = new Date().toISOString();
const inputs = await fetchLiveCaseInputs();
const { snapshot, graph, tomography } = createLiveEvidenceSnapshot(inputs, observedAt);
const directory = join(process.cwd(), "data", "snapshots");
const filename = `${snapshot.snapshotId}-${observedAt.replaceAll(":", "-")}.json`;
await mkdir(directory, { recursive: true });
await writeFile(join(directory, filename), JSON.stringify({ snapshot, graph, tomography }, null, 2));
console.log(join("data", "snapshots", filename));
