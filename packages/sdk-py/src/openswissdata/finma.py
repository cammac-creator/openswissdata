"""FINMA registry loader."""
from pathlib import Path
import pandas as pd


def load_finma_registry(csv_path: str | Path) -> pd.DataFrame:
    """Load the unified FINMA registry CSV (all 10 entity types).

    Args:
        csv_path: path to finma_registry.csv from the FINMA bundle ZIP.

    Returns:
        DataFrame with columns including entity_type, name, uid, canton, etc.
    """
    return pd.read_csv(csv_path, dtype=str, keep_default_na=False)
