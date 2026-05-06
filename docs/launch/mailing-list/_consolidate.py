#!/usr/bin/env python3
"""Consolide les 3 CSV mailing-list en un fichier final pour import Substack."""
import csv
import sys
from pathlib import Path

INPUT_FILES = [
    "finma-asr-contacts.csv",
    "fintech-banking-contacts.csv",
    "erp-export-contacts.csv",
]
OUTPUT = "_consolidated-substack-import.csv"
HEADERS = ["email", "prenom", "nom", "entreprise", "segment", "source", "base_legale", "domaine_site", "opt_in_pending", "notes"]

seen_emails = set()
all_rows = []
stats_by_segment = {}
stats_by_source = {}
duplicates = 0

for input_file in INPUT_FILES:
    path = Path(input_file)
    if not path.exists():
        print(f"  ⚠️  {input_file} not found, skipping")
        continue
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Skip comment lines
            if not row.get("email") or row.get("email", "").startswith("#"):
                continue
            email = row["email"].strip().lower()
            if not email or "@" not in email:
                continue
            if email in seen_emails:
                duplicates += 1
                continue
            seen_emails.add(email)
            # Stats
            seg = row.get("segment", "unknown")
            src = row.get("source", "unknown")
            stats_by_segment[seg] = stats_by_segment.get(seg, 0) + 1
            stats_by_source[src] = stats_by_source.get(src, 0) + 1
            all_rows.append(row)

# Write consolidated CSV
with open(OUTPUT, "w", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=HEADERS, extrasaction="ignore")
    writer.writeheader()
    for row in all_rows:
        writer.writerow({h: row.get(h, "") for h in HEADERS})

# Also produce a Substack-import-ready version (only email + name)
SUBSTACK_OUT = "_substack-import.csv"
with open(SUBSTACK_OUT, "w", encoding="utf-8", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["email", "first_name", "last_name"])
    for row in all_rows:
        writer.writerow([row["email"], row.get("prenom", ""), row.get("nom", "")])

print(f"✓ {len(all_rows)} contacts uniques consolidés")
print(f"  ({duplicates} doublons éliminés)")
print()
print("📊 Par segment:")
for seg, count in sorted(stats_by_segment.items(), key=lambda x: -x[1]):
    print(f"  {count:4d}  {seg}")
print()
print("📊 Par source:")
for src, count in sorted(stats_by_source.items(), key=lambda x: -x[1]):
    print(f"  {count:4d}  {src}")
