from scripts.export_openapi import OUTPUT, render


def test_committed_openapi_is_up_to_date():
    # 실패하면 `make api-types`를 실행해서 openapi.json과 모바일 TS 타입을 다시 생성한다.
    assert OUTPUT.read_text() == render()
