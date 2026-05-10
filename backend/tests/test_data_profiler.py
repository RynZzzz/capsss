import unittest

import pandas as pd

from app.services.ETL.data_profiler import ColumnStats, DataProfiler, DataType


class DataProfilerTests(unittest.TestCase):
    def test_profile_does_not_crash_all_missing_column(self):
        df = pd.DataFrame({"all_missing": [None, None, None]})
        profile = DataProfiler(df).profile(preview_rows=2)
        self.assertIn("metadata", profile)
        self.assertIn("columns", profile)
        self.assertIn("data", profile)

    def test_profile_includes_preview_rows_with_index(self):
        df = pd.DataFrame({"a": [1, 2, 3]})
        profile = DataProfiler(df).profile(preview_rows=2)
        self.assertEqual(len(profile["data"]), 2)
        self.assertIn("_index", profile["data"][0])

    def test_stats_to_dict_allows_null_min_max_for_numeric(self):
        stats = ColumnStats(
            name="x",
            data_type=DataType.INTEGER,
            total_count=3,
            non_null_count=0,
            missing_count=3,
            missing_indices=[0, 1, 2],
            unique_count=0,
        )
        profiler = DataProfiler(pd.DataFrame({"x": [None, None, None]}))
        payload = profiler._stats_to_dict(stats)
        self.assertIn("min", payload)
        self.assertIn("max", payload)
        self.assertIsNone(payload["min"])
        self.assertIsNone(payload["max"])


if __name__ == "__main__":
    unittest.main()
