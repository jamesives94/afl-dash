#!/usr/bin/env python3
import argparse
import csv
import json
import os
from pathlib import Path
from datetime import datetime, timezone

REQUIRED_FILES = [
    "roster_players.csv",
    "roster_players_aflw.csv",
    "team_kpis.csv",
    "team_kpis_aflw.csv",
    "team_rank_timeseries.csv",
    "team_rank_timeseries_aflw.csv",
    "team_skill_radar.csv",
    "team_skill_radar_aflw.csv",
    "player_acquisition_breakdown.csv",
    "player_acquisition_breakdown_aflw.csv",
    "player_projection.csv",
    "player_projections.csv",
    "player_projections_aflw.csv",
    "form_player_afl.csv",
    "form_player_aflw.csv",
    "form_player_vfl.csv",
    "career_projections.csv",
    "CD_player_stats_agg.csv",
    "comparable_players.csv",
]

SOURCE_FILE_CANDIDATES = {
    "career_projections.csv": ["career_projections_true_talent.csv", "career_projections.csv"],
    "comparable_players.csv": ["comparable_players_true_talent.csv", "comparable_players.csv"],
}

TRUE_TALENT_OUTPUTS_SOURCE = Path(
    "/Users/jamesives/Library/Mobile Documents/com~apple~CloudDocs/Analytics Projects/outputs/afl_player_true_talent"
)
DEFAULT_OUTPUTS_SOURCE = Path("/Users/jamesives/Library/Mobile Documents/com~apple~CloudDocs/Analytics Projects/01 Projects/Tasmania Production/outputs/current")


def find_source_dirs(cli_source: str | None, repo_root: Path) -> list[Path]:
    candidates: list[Path] = []
    if cli_source:
        candidates.append(Path(cli_source).expanduser())
    env_source = os.getenv("LOCAL_DATA_SOURCE_DIR", "").strip()
    if env_source:
        candidates.append(Path(env_source).expanduser())
    candidates.append(DEFAULT_OUTPUTS_SOURCE)
    candidates.append(TRUE_TALENT_OUTPUTS_SOURCE)
    candidates.append(repo_root / "public" / "data")

    out = []
    seen = set()
    for c in candidates:
        key = str(c.resolve()) if c.exists() else str(c)
        if key in seen:
            continue
        seen.add(key)
        if c.exists() and c.is_dir():
            out.append(c)

    if not out:
        raise FileNotFoundError(f"Could not find a valid source data dir. Checked: {', '.join(str(c) for c in candidates)}")
    return out


def resolve_source_file(file_name: str, source_dirs: list[Path]) -> tuple[Path | None, str | None]:
    source_names = SOURCE_FILE_CANDIDATES.get(file_name, [file_name])
    for source_name in source_names:
        for d in source_dirs:
            candidate = d / source_name
            if candidate.exists():
                return candidate, source_name
    return None, None


def read_csv_rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main():
    parser = argparse.ArgumentParser(description="Sync local JSON data files for offline app mode")
    parser.add_argument("--source", help="Source directory containing CSVs", default=None)
    parser.add_argument("--target", help="Target local-data directory", default=None)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    source_dirs = find_source_dirs(args.source, repo_root)
    primary_source_dir = source_dirs[0]
    target_dir = Path(args.target).expanduser() if args.target else (repo_root / "public" / "local-data")
    target_dir.mkdir(parents=True, exist_ok=True)

    copied = []
    missing = []

    for name in REQUIRED_FILES:
        src, source_name = resolve_source_file(name, source_dirs)
        if src is None:
            missing.append(name)
            continue
        rows = read_csv_rows(src)
        out_path = target_dir / f"{name}.json"
        out_path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        copied.append({
            "file": name,
            "sourceFile": source_name or name,
            "rows": len(rows),
            "lastModified": datetime.fromtimestamp(src.stat().st_mtime, tz=timezone.utc).isoformat(),
            "source": str(src),
            "target": str(out_path),
        })

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDir": str(primary_source_dir),
        "sourceDirCandidates": [str(d) for d in source_dirs],
        "files": copied,
        "missing": missing,
    }
    (target_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Synced {len(copied)} files to {target_dir}")
    if missing:
        print("Missing files (not fatal):")
        for m in missing:
            print(f"  - {m}")


if __name__ == "__main__":
    main()
