from app.monitoring import _scrub

DB_ERROR = (
    "null value violates constraint\nDETAIL:  Failing row contains (비밀 메모\n줄).\n[SQL: INSERT]"
)


def test_scrub_removes_row_values_and_query():
    event = {
        "exception": {"values": [{"value": DB_ERROR}]},
        "request": {"url": "https://api/x", "query_string": "device_id=abc"},
    }

    scrubbed = _scrub(event, None)

    assert scrubbed["exception"]["values"][0]["value"] == "null value violates constraint"
    assert "query_string" not in scrubbed["request"]
