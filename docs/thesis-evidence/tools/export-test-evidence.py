"""Export test names and outcomes while dropping host names, paths and raw test output."""
import csv
import json
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

SOURCE = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[1] / "tests"
NS = {"t": "http://microsoft.com/schemas/VisualStudio/TeamTest/2010"}


def trx(name):
    root = ET.parse(SOURCE / name).getroot()
    definitions = {
        test.get("id"): test.find("t:TestMethod", NS).get("className")
        for test in root.findall("t:TestDefinitions/t:UnitTest", NS)
    }
    return [
        (definitions[result.get("testId")], result.get("testName"), result.get("outcome"))
        for result in root.findall("t:Results/t:UnitTestResult", NS)
    ]


def junit():
    root = ET.parse(SOURCE / "frontend.xml").getroot()
    return [
        (test.get("classname"), test.get("name"), "Failed" if test.find("failure") is not None
         or test.find("error") is not None else "Skipped" if test.find("skipped") is not None else "Passed")
        for test in root.iter("testcase")
    ]


def write_cases(name, rows, expected):
    assert Counter(row[2] for row in rows) == expected
    with (OUT / name).open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file, delimiter="\t", lineterminator="\n")
        writer.writerow(["suite", "case", "outcome"])
        writer.writerows(sorted(rows))


write_cases("api-elso-futas.tsv", trx("backend.trx"), {"Passed": 236, "Failed": 4})
write_cases("api-kontrollalt.tsv", trx("backend-controlled.trx"), {"Passed": 240})
write_cases("frontend.tsv", junit(), {"Passed": 257})
write_cases("vezerlokozpont.tsv", trx("desktop.trx"), {"Passed": 16})

profiles = [json.loads(line)["profile"] for line in (SOURCE / "smoke.log").read_text(encoding="utf-8").splitlines() if line.startswith("{")]
assert profiles == ["desktop", "slow-mobile", "software", "no-webgl"]
assert (SOURCE / "smoke.exit").read_text().strip() == "0"
captures = {}
for name in ("capture.log", "capture-final.log", "capture-polish.log"):
    for line in (SOURCE / name).read_text(encoding="utf-8").splitlines():
        if " | #/" in line:
            image, route = line.split(" | ")
            captures[image] = route
assert len(captures) == 12
assert (SOURCE / "capture-polish.exit").read_text().strip() == "0"
lines = ["Böngészőprofil\tKimenet"] + [f"{name}\tPassed" for name in profiles]
lines += ["", "PNG\tHash útvonal"] + [f"{name}.png\t{route}" for name, route in sorted(captures.items())]
(OUT / "bongeszo.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
