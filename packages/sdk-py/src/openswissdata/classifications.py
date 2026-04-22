"""Swiss economic classifications loader (NOGA + NACE + ISIC)."""
from pathlib import Path
import pandas as pd


def load_classifications(base_dir: str | Path) -> pd.DataFrame:
    """Load all 5 nomenclatures from a Classifications bundle directory.

    Args:
        base_dir: path to the unzipped Classifications bundle.

    Returns:
        Concatenated DataFrame with a `scheme` column.
    """
    base = Path(base_dir)
    parts = []
    for filename, scheme in [
        ("noga_2008.csv", "NOGA_2008"),
        ("noga_2025.csv", "NOGA_2025"),
        ("nace_2_0.csv", "NACE_2.0"),
        ("nace_2_1.csv", "NACE_2.1"),
        ("isic_4.csv", "ISIC_4"),
    ]:
        df = pd.read_csv(base / filename, dtype=str, keep_default_na=False)
        df["scheme"] = scheme
        parts.append(df)
    return pd.concat(parts, ignore_index=True)


def load_cross_walks(csv_path: str | Path) -> pd.DataFrame:
    """Load the 5-way cross-walks CSV."""
    return pd.read_csv(csv_path, dtype=str, keep_default_na=False)
