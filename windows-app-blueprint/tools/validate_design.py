"""Read-only design checks; optionally write a JSON report to a chosen path.

Run from any directory: python path/to/validate_design.py --report result.json
This checks documentation consistency, not the future application's behavior.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    design = Path(__file__).resolve().parents[1]
    repo = design.parent
    errors: list[str] = []
    warnings: list[str] = []
    documents = sorted(design.rglob("*.md"))
    checked_links = 0
    for document in documents:
        body = document.read_text(encoding="utf-8-sig")
        if "\ufffd" in body:
            errors.append(f"Replacement character: {document.relative_to(design)}")
        if len(re.findall(r"^```", body, re.M)) % 2:
            errors.append(f"Unclosed code fence: {document.relative_to(design)}")
        for match in re.finditer(r"\[[^\]\n]*\]\(([^)\n]+)\)", body):
            target = match.group(1).strip()
            if target.startswith(("https://", "http://", "mailto:", "#", "codex://")):
                continue
            if target.startswith("<") and ">" in target:
                target = target[1:target.index(">")]
            target = unquote(target.split("#", 1)[0])
            if not target:
                continue
            checked_links += 1
            if not (document.parent / target).exists():
                errors.append(f"Broken file link: {document.relative_to(design)} -> {target}")

    scope = (design / "01_SCOPE_AND_FEATURE_PARITY.md").read_text(encoding="utf-8-sig")
    screens = (design / "05_SCREEN_SPECIFICATIONS.md").read_text(encoding="utf-8-sig")
    plan_path = design / "06_IMPLEMENTATION_AND_TEST_PLAN.md"
    plan = plan_path.read_text(encoding="utf-8-sig") if plan_path.exists() else ""
    features = re.findall(r"^\|\s*(WF-\d{3})\s*/", scope, re.M)
    expected_features = [f"WF-{number:03d}" for number in range(1, 68)]
    if features != expected_features:
        errors.append("Feature rows are not exactly WF-001 through WF-067 in order")
    missing_plan_ids = [feature for feature in expected_features if feature not in plan]
    if missing_plan_ids:
        errors.append(f"Feature IDs missing from implementation/test plan: {missing_plan_ids}")

    source_path = repo / "src" / "App.tsx"
    routes: list[str] = []
    if source_path.exists():
        routes = re.findall(r'<Route\s+path="([^"]+)"', source_path.read_text(encoding="utf-8-sig"))
        for name, body in [("scope", scope), ("screens", screens)]:
            missing = [route for route in routes if f"`{route}`" not in body]
            if missing:
                errors.append(f"Routes missing from {name}: {missing}")
        if len(routes) != 41:
            errors.append(f"Source route count changed: expected 41, found {len(routes)}")
    else:
        warnings.append("Source App.tsx absent; route parity check skipped. Run next to the original repository.")

    baseline_path = design / "DESIGN_BASELINE.json"
    baseline_checked = 0
    if baseline_path.exists():
        baseline = json.loads(baseline_path.read_text(encoding="utf-8-sig"))
        for entry in baseline["files"]:
            path = design / entry["path"]
            baseline_checked += 1
            digest = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
            if digest != entry["sha256"]:
                errors.append(f"Baseline hash mismatch: {entry['path']}")
    else:
        warnings.append("Design baseline not recorded yet")

    report = {
        "checked_at_utc": datetime.now(timezone.utc).isoformat(),
        "kind": "documentation_consistency_only",
        "markdown_documents": len(documents),
        "local_links_checked": checked_links,
        "source_route_declarations": len(routes),
        "feature_rows": len(features),
        "implementation_ids_missing": missing_plan_ids,
        "baseline_files_checked": baseline_checked,
        "warnings": warnings,
        "errors": errors,
        "passed": not errors,
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.resolve().write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
