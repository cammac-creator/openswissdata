"""TARES dataset loader."""
from pathlib import Path
import pandas as pd


def load_tares(csv_path: str | Path) -> pd.DataFrame:
    """Load a TARES bundle CSV into a typed DataFrame.

    Args:
        csv_path: path to tares.csv from the TARES bundle ZIP.

    Returns:
        DataFrame with HS8 codes, designations (FR/DE/IT/EN), duties, regimes.
    """
    return pd.read_csv(
        csv_path,
        dtype={"hs8": str, "hs6": str},
        keep_default_na=False,
    )
