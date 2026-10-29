import fs from "node:fs";
import path from "node:path";
import Copilot from "@/components/Copilot";

export default function Page() {
  const sampleCsv = fs.readFileSync(path.join(process.cwd(), "samples", "portfolio.csv"), "utf8");
  return <Copilot sampleCsv={sampleCsv} />;
}
